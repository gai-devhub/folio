from __future__ import annotations

import atexit
import platform
import subprocess
import tempfile
from pathlib import Path


_SWIFT_RENDERER = r'''
import AppKit
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 4,
      let document = PDFDocument(url: URL(fileURLWithPath: args[1])),
      let pageIndex = Int(args[2]),
      let page = document.page(at: pageIndex) else {
    fputs("Unable to read requested PDF page", stderr)
    exit(2)
}

let sourceBounds = page.bounds(for: .mediaBox)
let scale = min(1600.0 / max(sourceBounds.width, 1), 2.0)
let width = max(1, Int(sourceBounds.width * scale))
let height = max(1, Int(sourceBounds.height * scale))
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 32
) else {
    fputs("Unable to allocate page image", stderr)
    exit(3)
}

let graphics = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics?.imageInterpolation = .high
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
graphics?.cgContext.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: graphics!.cgContext)
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Unable to encode page image", stderr)
    exit(4)
}
do {
    try png.write(to: URL(fileURLWithPath: args[3]))
    print(document.pageCount)
} catch {
    fputs("Unable to save page image", stderr)
    exit(5)
}
'''

_renderer_temp: tempfile.TemporaryDirectory[str] | None = None
_renderer_binary: Path | None = None


def _get_renderer() -> Path:
    global _renderer_temp, _renderer_binary
    if _renderer_binary and _renderer_binary.exists():
        return _renderer_binary
    if platform.system() != "Darwin":
        raise RuntimeError("The built-in PDF renderer is currently available on macOS.")

    swiftc = Path("/usr/bin/swiftc")
    if not swiftc.exists():
        raise RuntimeError("Install the macOS command line tools to render PDF pages.")

    _renderer_temp = tempfile.TemporaryDirectory(prefix="folio-pdf-preview-")
    atexit.register(_renderer_temp.cleanup)
    directory = Path(_renderer_temp.name)
    module_cache = directory / "module-cache"
    module_cache.mkdir()
    source = directory / "renderer.swift"
    binary = directory / "renderer"
    source.write_text(_SWIFT_RENDERER)
    result = subprocess.run(
        [
            str(swiftc), str(source), "-O", "-module-cache-path",
            str(module_cache), "-o", str(binary),
        ],
        capture_output=True,
        text=True,
        timeout=90,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Could not build the PDF renderer.")
    _renderer_binary = binary
    return binary


def render_pdf_page(content: bytes, page_index: int) -> tuple[bytes, int]:
    """Rasterize one PDF page with macOS PDFKit without adding Python packages."""
    if page_index < 0:
        raise ValueError("Page number must be zero or greater.")
    renderer = _get_renderer()
    with tempfile.TemporaryDirectory(prefix="folio-pdf-page-") as temp_dir:
        pdf_path = Path(temp_dir) / "source.pdf"
        image_path = Path(temp_dir) / "page.png"
        pdf_path.write_bytes(content)
        result = subprocess.run(
            [str(renderer), str(pdf_path), str(page_index), str(image_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            if "requested PDF page" in result.stderr:
                raise IndexError("PDF page does not exist.")
            raise RuntimeError(result.stderr.strip() or "Could not render this PDF page.")
        return image_path.read_bytes(), int(result.stdout.strip())
