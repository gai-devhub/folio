"""Intelligent file organization using LLM (Gemini/OpenAI) or smart thematic clustering."""

from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import base64
from docx import Document
from pptx import Presentation
from pypdf import PdfReader

logger = logging.getLogger(__name__)

THUMBNAILS_DIR = Path(__file__).resolve().parent.parent / "thumbnails"
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)


def _extract_legacy_office_text(name: str, content: bytes) -> str:
    """Use existing system converters for legacy Office formats when available."""
    extension = Path(name).suffix.lower()
    with tempfile.TemporaryDirectory(prefix="folio-preview-") as temp_dir:
        source = Path(temp_dir) / Path(name).name
        source.write_bytes(content)

        textutil = shutil.which("textutil")
        if extension == ".doc" and textutil:
            try:
                result = subprocess.run(
                    [textutil, "-convert", "txt", "-stdout", str(source)],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=True,
                )
                if result.stdout.strip():
                    return result.stdout[:20000]
            except (OSError, subprocess.SubprocessError):
                pass

        office = shutil.which("libreoffice") or shutil.which("soffice")
        if office:
            try:
                subprocess.run(
                    [office, "--headless", "--convert-to", "txt", "--outdir", temp_dir, str(source)],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=True,
                )
                converted = source.with_suffix(".txt")
                if converted.exists():
                    return converted.read_text(errors="ignore")[:20000]
            except (OSError, subprocess.SubprocessError):
                pass

    # Legacy PowerPoint and Excel files are OLE binaries. Recover readable strings
    # as a local fallback when no Office converter is installed.
    decoded = content.decode("utf-16le", errors="ignore")
    wide_strings = re.findall(r"[\w\s.,;:!?()'\"&%/\-]{4,}", decoded)
    wide_strings = [
        value.strip()
        for value in wide_strings
        if sum(char.isalpha() for char in value) >= 4
    ]
    ansi_strings = [
        value.decode("latin-1", errors="ignore").strip()
        for value in re.findall(rb"[ -~]{5,}", content)
    ]
    readable = list(dict.fromkeys(wide_strings + ansi_strings))
    return "\n".join(readable)[:20000]


def generate_thumbnail_from_path(file_path: str | Path, out_dir: Path = THUMBNAILS_DIR) -> str | None:
    """Generate high-resolution Finder-style thumbnail using native macOS Quick Look."""
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return None
    safe_name = f"{p.name}.png"
    out_png = out_dir / safe_name
    if out_png.exists() and out_png.stat().st_size > 500:
        return str(out_png)

    import shutil
    import subprocess
    import tempfile

    # If it is an image file directly, we can optimize or copy
    ext = p.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        try:
            shutil.copy(p, out_png)
            return str(out_png)
        except Exception:
            pass

    try:
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(
                ["qlmanage", "-t", "-s", "280", "-o", td, str(p)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=6,
            )
            produced = list(Path(td).glob("*.png"))
            if produced:
                shutil.copy(produced[0], out_png)
                return str(out_png)
    except Exception as e:
        logger.warning(f"Error generating thumbnail for {file_path}: {e}")
    return None


def generate_thumbnail_from_bytes(filename: str, content: bytes, out_dir: Path = THUMBNAILS_DIR) -> str | None:
    """Generate thumbnail for uploaded file bytes using native Quick Look."""
    safe_name = f"{filename}.png"
    out_png = out_dir / safe_name
    if out_png.exists() and out_png.stat().st_size > 500:
        return str(out_png)

    import shutil
    import subprocess
    import tempfile

    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        try:
            out_png.write_bytes(content)
            return str(out_png)
        except Exception:
            pass

    try:
        with tempfile.TemporaryDirectory() as td:
            tmp_src = Path(td) / filename
            tmp_src.write_bytes(content)
            subprocess.run(
                ["qlmanage", "-t", "-s", "280", "-o", td, str(tmp_src)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=6,
            )
            produced = list(Path(td).glob("*.png"))
            if produced:
                shutil.copy(produced[0], out_png)
                return str(out_png)
    except Exception as e:
        logger.warning(f"Error generating thumbnail for {filename}: {e}")
    return None

STOP_WORDS = set("""
a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing down during each few file files document
documents slide slides presentation deck for from further had has have having he her here him his
how i if in into is it its me more most my no nor not of off on once only or other our out over own
same she should so some such than that the their them then there these they this those through to
too under until up very was we were what when where which while who whom why with would you your
using used page total true false item items data
""".split())

# Thematic domain dictionaries for zero-API-key content categorization
DOMAINS: dict[str, set[str]] = {
    "Finance & Accounting": {
        "invoice", "receipt", "budget", "expense", "expenses", "financial", "tax", "taxes",
        "payment", "billing", "revenue", "accounting", "payroll", "audit", "profit",
        "balance", "ledger", "cost", "pricing", "forecast", "salary", "fiscal", "quarterly"
    },
    "Marketing & Presentations": {
        "strategy", "pitch", "presentation", "slide", "deck", "marketing", "audience",
        "campaign", "brand", "branding", "roadmap", "launch", "growth", "market", "vision",
        "competitor", "client", "proposal", "outreach", "persona", "funnel"
    },
    "Contracts & Legal": {
        "agreement", "contract", "nda", "policy", "terms", "privacy", "compliance",
        "legal", "liability", "clause", "signature", "signed", "license", "disclaimer",
        "governance", "regulation", "statute", "intellectual", "property"
    },
    "Research & Insights": {
        "research", "study", "analysis", "notes", "interview", "article", "report",
        "summary", "findings", "reference", "paper", "draft", "insights", "survey",
        "methodology", "literature", "abstract", "experiment", "evaluation"
    },
    "Engineering & Tech": {
        "code", "api", "database", "query", "script", "function", "server", "build",
        "config", "json", "backend", "frontend", "architecture", "schema", "deploy",
        "error", "bug", "log", "software", "endpoint", "pipeline", "docker", "test"
    },
    "Operations & Planning": {
        "schedule", "agenda", "minutes", "meeting", "onboarding", "roster", "employee",
        "workflow", "task", "tasks", "checklist", "status", "action", "project",
        "operations", "logistics", "milestone", "timeline", "calendar"
    },
    "Creative & Assets": {
        "image", "photo", "design", "logo", "vector", "icon", "media", "audio",
        "video", "asset", "font", "illustration", "graphic", "artwork", "layout"
    },
}


@dataclass
class FileRecord:
    name: str
    body: bytes
    text: str
    tokens: list[str]
    size: int


def extract_text(name: str, content: bytes) -> str:
    """Extract legible text from office documents, PDFs, or raw text files."""
    extension = Path(name).suffix.lower()
    try:
        if extension in {".doc", ".ppt", ".xls"}:
            return _extract_legacy_office_text(name, content)
        if extension == ".pdf":
            pages = PdfReader(io.BytesIO(content)).pages
            return "\n\n".join(
                f"Page {index}:\n{page.extract_text() or ''}"
                for index, page in enumerate(pages[:20], start=1)
            )
        if extension == ".pptx":
            deck = Presentation(io.BytesIO(content))
            slides = []
            for index, slide in enumerate(deck.slides, start=1):
                lines = [
                    shape.text.strip()
                    for shape in slide.shapes
                    if shape.has_text_frame and shape.text.strip()
                ]
                slides.append(f"Slide {index}\n" + "\n".join(lines))
            return "\n\n".join(slides)
        if extension == ".docx":
            document = Document(io.BytesIO(content))
            paragraphs = [p.text for p in document.paragraphs if p.text]
            for table in document.tables:
                for row in table.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        paragraphs.append(" | ".join(cells))
            return "\n\n".join(paragraphs)
        if extension == ".odt":
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                root = ET.fromstring(archive.read("content.xml"))
            text_nodes = [
                "".join(child.text or "" for child in node.iter()).strip()
                for node in root.iter()
                if node.tag.endswith(("}p", "}h"))
                and "".join(child.text or "" for child in node.iter()).strip()
            ]
            return "\n\n".join(text_nodes)
        if extension in {".xlsx", ".xlsm"}:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                shared = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                    shared = [
                        "".join(node.text or "" for node in item.findall(".//x:t", ns))
                        for item in root.findall("x:si", ns)
                    ]
                sheets = sorted(
                    name for name in archive.namelist()
                    if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)
                )
                output = []
                for index, sheet_path in enumerate(sheets, start=1):
                    root = ET.fromstring(archive.read(sheet_path))
                    rows = []
                    for row in root.findall(".//x:sheetData/x:row", ns):
                        values = []
                        for cell in row.findall("x:c", ns):
                            value = cell.find("x:v", ns)
                            text = value.text if value is not None else ""
                            if cell.get("t") == "s" and text.isdigit():
                                text = shared[int(text)] if int(text) < len(shared) else text
                            elif cell.get("t") == "inlineStr":
                                text = "".join(
                                    node.text or "" for node in cell.findall(".//x:t", ns)
                                )
                            if text:
                                values.append(text)
                        if values:
                            rows.append(" | ".join(values))
                    output.append(f"Sheet {index}\n" + "\n".join(rows))
                return "\n\n".join(output)
        if extension in {".txt", ".md", ".csv", ".json", ".log"}:
            return content.decode("utf-8", errors="ignore")[:20000]
        if extension == ".rtf":
            raw = content.decode("utf-8", errors="ignore")
            raw = re.sub(r"\\'[0-9a-fA-F]{2}", "", raw)
            raw = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", raw)
            return re.sub(r"[{}]", "", raw)[:20000]
    except Exception:
        if extension in {".txt", ".md", ".csv", ".json", ".log"}:
            return content.decode("utf-8", errors="ignore")[:20000]
    return ""


def _tokens(text: str) -> list[str]:
    """Tokenize text into lower-case clean words of length 3+."""
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text.lower())
    return [w for w in words if w not in STOP_WORDS]


def _call_gemini_llm(records: list[FileRecord]) -> dict[str, list[dict[str, Any]]] | None:
    """Optionally organize via Gemini API if GEMINI_API_KEY is available."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import httpx

        files_info = []
        for r in records:
            preview = (r.text[:800] if r.text else "No text extracted").replace("\n", " ").strip()
            files_info.append({
                "name": r.name,
                "content_preview": preview,
                "file_type": Path(r.name).suffix.lower() or "file",
            })

        prompt = f"""You are an expert file organizer for students, educators, and professionals.
Analyze the following {len(records)} files based on their filenames and content excerpts.

OBJECTIVE:
Organize these files into clean, logical folders representing each distinct course, subject, or project topic.

RULES:
1. TOPIC & COURSE DETECTION:
   - Identify each distinct course, academic subject, or project (e.g. 'CS101 Data Structures', 'MATH201 Linear Algebra', 'BIO105 Cell Biology', 'ECON102 Macroeconomics', 'HIST110 World History').
   - Create a dedicated folder for EVERY distinct course or subject. If there are 10 or 15 different courses, create 10 or 15 course folders. Do NOT artificially compress different courses into the same folder!
2. COHESIVE GROUPING:
   - All lecture slides, notes, assignments, syllabi, or materials belonging to the SAME course must be grouped together into that course's folder (e.g., Week 1, Week 2, and Week 3 slides of CS101 all go into the same 'CS101 Data Structures' folder).
3. COVERAGE:
   - Every file must be assigned to exactly one folder.
4. FOLDER NAMING:
   - Use clean, recognizable, Title Case folder names (e.g. 'CS101 Data Structures', 'BIO201 Molecular Biology', 'ECON102 Macroeconomics', 'Financial Statements', 'Marketing Strategy').

Files to organize:
{json.dumps(files_info, indent=2)}

Respond with ONLY valid JSON adhering strictly to this schema:
{{
  "folders": [
    {{
      "name": "Course or Topic Name",
      "files": ["filename1.ext", "filename2.ext"],
      "reason": "Clear explanation of the course or subject shared by these files"
    }}
  ]
}}
"""
        models_to_try = ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest"]
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
        }

        with httpx.Client(timeout=20.0) as client:
            for model_name in models_to_try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                resp = client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    text_out = data["candidates"][0]["content"]["parts"][0]["text"]
                    logger.info("Organized files via Gemini model %s", model_name)
                    return json.loads(text_out)
                else:
                    logger.warning("Gemini model %s returned status %d: %s", model_name, resp.status_code, resp.text[:120])
    except Exception as exc:
        logger.warning("Gemini LLM organization failed, falling back to smart clustering: %s", exc)
    return None


def organize_file_records(files: list[tuple[str, bytes]]) -> tuple[dict[str, list[tuple[str, bytes]]], list[dict[str, Any]]]:
    """
    Intelligently organize files based on their extracted content.
    Caps total folder count to avoid fragmentation (2 to 4 folders for typical batches).
    Uses Gemini LLM if configured; otherwise uses high-precision content domain clustering.
    """
    if not files:
        return {}, []

    records: list[FileRecord] = []
    file_bytes_map: dict[str, bytes] = {}

    for name, body in files:
        file_bytes_map[name] = body
        extracted = extract_text(name, body)
        stem_tokens = _tokens(Path(name).stem.replace("_", " ").replace("-", " "))
        content_tokens = _tokens(extracted)
        all_tokens = stem_tokens * 2 + content_tokens  # give filename terms weight
        records.append(FileRecord(
            name=name,
            body=body,
            text=extracted,
            tokens=all_tokens,
            size=len(body),
        ))

    # 1. Try Gemini LLM if key is present (dynamically detects courses/subjects)
    llm_result = _call_gemini_llm(records)
    if llm_result and "folders" in llm_result and isinstance(llm_result["folders"], list):
        organized_folders: dict[str, list[tuple[str, bytes]]] = {}
        manifest: list[dict[str, Any]] = []
        assigned_names: set[str] = set()

        for group in llm_result["folders"]:
            raw_folder_name = group.get("name", "General Documents")
            folder_name = (raw_folder_name.strip() if isinstance(raw_folder_name, str) else "General Documents") or "General Documents"
            folder_name = re.sub(r'[^\w\s&_-]', '', folder_name)[:50]
            reason = group.get("reason", "Organized by AI content analysis")

            group_files: list[tuple[str, bytes]] = []
            for fname in group.get("files", []):
                if isinstance(fname, str) and fname in file_bytes_map and fname not in assigned_names:
                    group_files.append((fname, file_bytes_map[fname]))
                    assigned_names.add(fname)
                    manifest.append({
                        "name": fname,
                        "folder": folder_name,
                        "reason": str(reason),
                        "size": len(file_bytes_map[fname]),
                        "extension": Path(fname).suffix.lower(),
                        "ai_classified": True,
                    })

            if group_files:
                organized_folders[folder_name] = group_files

        # Catch any missing files that LLM didn't return
        unassigned = [r for r in records if r.name not in assigned_names]
        if unassigned:
            fallback_folder = list(organized_folders.keys())[0] if organized_folders else "General Documents"
            for r in unassigned:
                organized_folders.setdefault(fallback_folder, []).append((r.name, r.body))
                manifest.append({
                    "name": r.name,
                    "folder": fallback_folder,
                    "reason": "Grouped with related files",
                    "size": r.size,
                    "extension": Path(r.name).suffix.lower(),
                    "ai_classified": True,
                })

        if organized_folders:
            return organized_folders, manifest

    # 2. Smart Thematic Clustering Engine (Content-Aware, Adaptive Cap)
    adaptive_max_folders = max(4, min(len(records), 20))
    return _smart_thematic_clustering(records, adaptive_max_folders)


def _smart_thematic_clustering(
    records: list[FileRecord],
    max_folders: int,
) -> tuple[dict[str, list[tuple[str, bytes]]], list[dict[str, Any]]]:
    """
    Groups files into coherent categories based on document contents.
    Dynamically creates dedicated folders for distinct courses, subjects, or projects,
    while grouping all lectures, slides, and notes for the same subject together.
    """
    course_pattern = re.compile(r'([a-zA-Z]{2,6}\s*[-_]?\s*\d{2,4})', re.IGNORECASE)

    # 1. Course Code Clustering (e.g. CS101, BIO201, MATH302, HIST110)
    course_groups: dict[str, list[FileRecord]] = {}
    remaining: list[FileRecord] = []

    for r in records:
        # Check filename first, then text content
        match = course_pattern.search(r.name) or course_pattern.search(r.text[:600])
        if match:
            code = re.sub(r'[\s_-]+', '', match.group(1)).upper()
            course_groups.setdefault(code, []).append(r)
        else:
            remaining.append(r)

    # Folders that have 2+ files sharing a course code get their own folder
    final_groups: dict[str, list[FileRecord]] = {}
    for code, items in list(course_groups.items()):
        # Find representative subject name if available in terms
        top_words = [w.title() for w, _ in Counter(w for it in items for w in it.tokens if w.lower() != code.lower()).most_common(2)]
        folder_label = f"{code} {' '.join(top_words)}".strip() if top_words else code
        final_groups[folder_label] = items

    # 2. For remaining files, score against thematic domains or cluster by shared topics
    if remaining:
        domain_assignments: dict[str, list[FileRecord]] = {}
        unmatched: list[FileRecord] = []

        for r in remaining:
            token_counts = Counter(r.tokens)
            scores: dict[str, float] = {}
            for domain_name, keywords in DOMAINS.items():
                matched_count = sum(token_counts[kw] for kw in keywords if kw in token_counts)
                if matched_count > 0:
                    scores[domain_name] = matched_count

            if scores:
                best_domain = max(scores.items(), key=lambda kv: kv[1])[0]
                domain_assignments.setdefault(best_domain, []).append(r)
            else:
                unmatched.append(r)

        # Merge domains into final_groups
        for domain_name, items in domain_assignments.items():
            final_groups[domain_name] = items

        # Group unmatched by mutual keyword overlap
        if unmatched:
            unmatched_clusters: list[list[FileRecord]] = []
            for r in unmatched:
                placed = False
                for cluster in unmatched_clusters:
                    shared = set(r.tokens) & set(cluster[0].tokens)
                    if len(shared) >= 2:
                        cluster.append(r)
                        placed = True
                        break
                if not placed:
                    unmatched_clusters.append([r])

            for cluster in unmatched_clusters:
                top_terms = [w.title() for w, _ in Counter(w for it in cluster for w in it.tokens).most_common(2)]
                cluster_name = " & ".join(top_terms) or "General Documents"
                if cluster_name in final_groups:
                    final_groups[cluster_name].extend(cluster)
                else:
                    final_groups[cluster_name] = cluster

    # Build final folders and manifest
    folders: dict[str, list[tuple[str, bytes]]] = {}
    manifest: list[dict[str, Any]] = []

    for folder_name, items in final_groups.items():
        clean_name = re.sub(r'[^\w\s&_-]', '', folder_name).strip()[:50] or "General Documents"
        folders[clean_name] = [(it.name, it.body) for it in items]

        sample_terms = Counter(w for it in items for w in it.tokens).most_common(3)
        terms_str = ", ".join(w for w, _ in sample_terms)
        reason = f"Grouped into {clean_name} based on course and subject context ({terms_str})" if terms_str else f"Grouped into {clean_name}"

        for it in items:
            manifest.append({
                "name": it.name,
                "folder": clean_name,
                "reason": reason,
                "size": it.size,
                "extension": Path(it.name).suffix.lower(),
                "ai_classified": False,
            })

    return folders, manifest


def build_zip(folders: dict[str, list[tuple[str, bytes]]], manifest: list[dict[str, Any]]) -> io.BytesIO:
    """Build in-memory ZIP archive with organized subfolders and manifest."""
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        for folder, files in folders.items():
            for filename, content in files:
                zipped.writestr(f"{folder}/{filename}", content)
        zipped.writestr("organizer-manifest.json", json.dumps(manifest, indent=2))
    archive.seek(0)
    return archive


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"}


def summarize_document(
    filename: str,
    text: str = "",
    folder: str = "",
    image_bytes: bytes | None = None,
    custom_instructions: str = "",
) -> dict[str, Any]:
    """Generate an AI summary and study takeaways for a document or image using Gemini or local extractor."""
    ext = Path(filename).suffix.lower()
    is_image = ext in IMAGE_EXTENSIONS or image_bytes is not None
    api_key = os.getenv("GEMINI_API_KEY")
    user_guidance = custom_instructions.strip()[:2000]

    if is_image and image_bytes:
        mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/gif" if ext == ".gif" else "image/svg+xml" if ext == ".svg" else "image/jpeg"
        b64_str = base64.b64encode(image_bytes).decode("utf-8")
        image_data_uri = f"data:{mime};base64,{b64_str}"

        if api_key:
            try:
                import httpx

                prompt = f"""You are an expert visual document and image analyst.
Analyze this image '{filename}' which has been organized into folder '{folder}'.
{f'User preferences for the summary and takeaways: {user_guidance}' if user_guidance else ''}
Describe what is visually shown, any visible text, diagrams, UI elements, charts, or slides, and why it belongs in '{folder}'.

Respond ONLY in valid JSON adhering strictly to:
{{
  "summary": "2-3 sentence overview describing what this image depicts",
  "key_points": ["Key visual element or insight 1", "Key visual element or insight 2", "Key visual element or insight 3"],
  "folder_relevance": "Why this image belongs in this folder"
}}
"""
                payload = {
                    "contents": [{
                        "parts": [
                            {"text": prompt},
                            {"inlineData": {"mimeType": mime, "data": b64_str}},
                        ]
                    }],
                    "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
                }

                with httpx.Client(timeout=15.0) as client:
                    for model_name in ["gemini-flash-lite-latest", "gemini-flash-latest"]:
                        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                        resp = client.post(url, json=payload)
                        if resp.status_code == 200:
                            data = resp.json()
                            text_out = data["candidates"][0]["content"]["parts"][0]["text"]
                            parsed = json.loads(text_out)
                            return {
                                "filename": filename,
                                "folder": folder,
                                "summary": parsed.get("summary", "Visual image analyzed by Gemini Vision AI."),
                                "key_points": parsed.get("key_points", []),
                                "folder_relevance": parsed.get("folder_relevance", f"Categorized in {folder}"),
                                "content_preview": f"Image file: {filename} ({len(image_bytes) / 1024:.1f} KB)",
                                "image_data": image_data_uri,
                                "is_image": True,
                                "ai_powered": True,
                            }
            except Exception as exc:
                logger.warning("Gemini image analysis failed: %s", exc)

        return {
            "filename": filename,
            "folder": folder,
            "summary": f"Image asset ({ext.upper().replace('.', '')}) categorized under {folder or 'Visual Assets'}.",
            "key_points": [
                f"Visual media: {filename}",
                f"File size: {len(image_bytes) / 1024:.1f} KB",
                "Ready for visual viewing and course review.",
            ],
            "folder_relevance": f"Categorized into {folder or 'Visual Assets'}.",
            "content_preview": f"Image file: {filename} ({len(image_bytes) / 1024:.1f} KB)",
            "image_data": image_data_uri,
            "is_image": True,
            "ai_powered": False,
        }

    content_preview = text[:8000].strip() if text else "No legible text content found in document."

    if api_key and len(content_preview) > 20:
        try:
            import httpx

            prompt = f"""You are an expert academic and professional document analyst.
Analyze the following document '{filename}' which belongs to folder '{folder}'.
{f'User preferences for the summary and takeaways: {user_guidance}' if user_guidance else ''}

DOCUMENT EXCERPT:
{content_preview[:4000]}

Provide:
1. "summary": A clear, executive 2-3 sentence summary explaining the core message, purpose, and findings.
2. "key_points": A list of 3 to 5 clear, bulleted takeaways (theorems, key facts, definitions, or main lessons).
3. "folder_relevance": A concise sentence explaining why this document belongs in '{folder}'.

Respond ONLY in valid JSON adhering strictly to:
{{
  "summary": "2-3 sentence overview",
  "key_points": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
  "folder_relevance": "Why it belongs in this folder"
}}
"""
            models_to_try = ["gemini-flash-lite-latest", "gemini-flash-latest"]
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
            }

            with httpx.Client(timeout=15.0) as client:
                for model_name in models_to_try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                    resp = client.post(url, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        text_out = data["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = json.loads(text_out)
                        return {
                            "filename": filename,
                            "folder": folder,
                            "summary": parsed.get("summary", "Document analyzed by Gemini AI."),
                            "key_points": parsed.get("key_points", []),
                            "folder_relevance": parsed.get("folder_relevance", f"Categorized in {folder}"),
                            "content_preview": content_preview,
                            "image_data": None,
                            "is_image": False,
                            "ai_powered": True,
                        }
        except Exception as exc:
            logger.warning("Gemini document summarization failed, falling back to local extractor: %s", exc)

    # Local intelligent fallback summarizer
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', content_preview) if len(s.strip()) > 15]
    summary_text = " ".join(sentences[:3]) if sentences else (content_preview[:240] + "...")
    key_points = [s for s in sentences[3:8] if len(s) > 20] or [
        f"Contains document content related to {folder or Path(filename).stem}.",
        f"File type: {Path(filename).suffix.upper()} ({len(content_preview)} characters of text extracted).",
        "Ready for contextual reading and review.",
    ]

    return {
        "filename": filename,
        "folder": folder,
        "summary": summary_text,
        "key_points": key_points[:5],
        "folder_relevance": f"Grouped into {folder or 'General Documents'} based on contextual topic keywords.",
        "content_preview": content_preview,
        "image_data": None,
        "is_image": False,
        "ai_powered": False,
    }


def chat_with_document(
    filename: str,
    content: str,
    message: str,
    history: list[dict[str, str]] | None = None,
    folder: str = "",
    assistant_mode: str = "auto",
    thinking_level: str = "medium",
    custom_instructions: str = "",
    attachment_context: str = "",
) -> str:
    """Answer questions conversationally about a specific document using Gemini or local context extractor."""
    api_key = os.getenv("GEMINI_API_KEY")
    document_text = content[:10000].strip() if content else f"Document: {filename} in folder {folder}."
    if attachment_context.strip():
        document_text += f"\n\nADDITIONAL ATTACHED FILE CONTEXT:\n{attachment_context[:12000].strip()}"

    if api_key:
        try:
            import httpx

            history_lines = []
            if history:
                for h in history[-6:]:
                    r = h.get("role", "user")
                    c = h.get("content", "")
                    history_lines.append(f"{r.capitalize()}: {c}")

            history_context = "\n".join(history_lines) if history_lines else "None"

            mode_guidance = {
                "auto": "Adapt the response style to the user's request. Prefer a quick, clear answer for simple questions and deeper analysis for complex ones.",
                "gil_v1": "Use the Gil.v1 style: everyday help with a quick, direct, concise answer.",
                "gil_v2": "Use the Gil.v2 style: carefully analyze the document and give a deeper, well-supported explanation.",
            }.get(assistant_mode, "Adapt the response style to the user's request.")
            thinking_guidance = {
                "low": "Keep reasoning and the final answer brief; focus on the direct answer.",
                "medium": "Give a balanced explanation with enough context to be useful.",
                "high": "Consider the relevant details carefully and provide a thorough explanation, while staying focused.",
            }.get(thinking_level, "Give a balanced explanation with enough context to be useful.")
            user_guidance = custom_instructions.strip()[:2000] or "No additional user preferences."

            prompt = f"""You are Gil, a friendly document assistant helping the user understand '{filename}' organized in folder '{folder}'.
When it feels natural, refer to yourself as Gil. Do not describe yourself as an AI unless the user asks.
Use the document's actual text content to answer the user's question clearly and accurately.
{mode_guidance}
{thinking_guidance}
Additional user preferences for summaries and explanations:
{user_guidance}

DOCUMENT CONTENT:
\"\"\"
{document_text}
\"\"\"

PREVIOUS CONVERSATION:
{history_context}

USER QUESTION:
{message}

INSTRUCTIONS:
1. Answer directly and concisely using facts from the document.
2. Use clear bullet points and bold text for readability.
3. If the document does not mention the answer, state that gently and offer relevant context from what is available.
"""
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.4,
                    "maxOutputTokens": {"low": 350, "medium": 700, "high": 1400}.get(thinking_level, 700),
                },
            }

            with httpx.Client(timeout=15.0) as client:
                model_order = ["gemini-flash-lite-latest", "gemini-flash-latest"]
                if assistant_mode == "gil_v2":
                    model_order.reverse()
                for model_name in model_order:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                    resp = client.post(url, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as exc:
            logger.warning("Gemini chat failed, falling back to local reply: %s", exc)

    # Local fallback reply
    words = [w for w in message.lower().split() if len(w) > 3 and w not in STOP_WORDS]
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', document_text) if len(s.strip()) > 15]
    matches = [s for s in sentences if any(w in s.lower() for w in words)]

    if matches:
        bullet_matches = "\n".join(f"• {m}" for m in matches[:3])
        return f"Based on '{filename}', here is the relevant information regarding your question:\n\n{bullet_matches}"
    elif sentences:
        return f"Regarding '{message}', '{filename}' covers the following core topic:\n\n{sentences[0]}"
    else:
        return f"'{filename}' has been organized into '{folder or 'your workspace'}'. Let me know if you would like a summary or key points!"
