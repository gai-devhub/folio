import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from pptx import Presentation
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
import database
from database import Base, User, get_db
from services.organizer import extract_text


class OrganizerApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{self.db_path}", connect_args={"check_same_thread": False})
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        database.engine = self.engine
        self.original_init_db = main.init_db
        main.init_db = lambda: Base.metadata.create_all(bind=self.engine)

        def override_db():
            session = self.session_factory()
            try:
                yield session
            finally:
                session.close()

        main.app.dependency_overrides[get_db] = override_db
        Base.metadata.create_all(bind=self.engine)
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        main.init_db = self.original_init_db
        main.app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_database_startup_and_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("users", Base.metadata.tables)

    def test_register_login_checkboss_and_organized_zip(self):
        registered = self.client.post("/api/register", json={"username": "reader", "password": "long-password", "checkboss": True})
        self.assertEqual(registered.status_code, 201)
        token = registered.json()["token"]
        self.assertEqual(self.client.post("/api/login", json={"username": "reader", "password": "long-password"}).status_code, 200)
        self.assertEqual(self.client.post("/api/login", json={"username": "reader", "password": "wrong-password"}).status_code, 401)

        session = self.session_factory()
        user = session.query(User).filter_by(username="reader").one()
        self.assertTrue(user.checkboss)
        self.assertNotEqual(user.password_hash, "long-password")
        session.close()

        slide_file = io.BytesIO()
        deck = Presentation()
        slide = deck.slides.add_slide(deck.slide_layouts[5])
        slide.shapes.title.text = "Solar energy policy"
        deck.save(slide_file)
        pptx = slide_file.getvalue()
        self.assertIn("solar energy policy", extract_text("solar-policy.pptx", pptx).lower())

        response = self.client.post("/api/organize", headers={"Authorization": f"Bearer {token}"}, files=[
            ("files", ("solar-policy.pptx", pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")),
            ("files", ("solar-notes.txt", b"solar energy policy and clean power", "text/plain")),
            ("files", ("payroll-budget.txt", b"finance payroll budget forecast", "text/plain")),
        ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Organized-Count"], "3")
        self.assertGreaterEqual(int(response.headers["X-Folder-Count"]), 2)
        summary = json.loads(response.headers["X-Organization-Summary"])
        self.assertEqual(sum(folder["count"] for folder in summary), 3)

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertIn("organizer-manifest.json", archive.namelist())
            self.assertEqual(sum(name.endswith((".txt", ".pptx")) for name in archive.namelist()), 3)
            self.assertEqual(len(json.loads(archive.read("organizer-manifest.json"))), 3)

    def test_local_folder_scan(self):
        registered = self.client.post("/api/register", json={"username": "localuser", "password": "testpassword123"})
        token = registered.json()["token"]

        scan_folder = Path(self.temp_dir.name) / "scan_target"
        scan_folder.mkdir(parents=True, exist_ok=True)
        (scan_folder / "slide1.txt").write_text("Artificial intelligence deep learning neural networks")
        (scan_folder / "slide2.txt").write_text("Deep learning backpropagation neural network architecture")
        (scan_folder / "subfolder").mkdir()
        (scan_folder / "subfolder" / "ignore.txt").write_text("already in folder")

        response = self.client.post("/api/local/scan", headers={"Authorization": f"Bearer {token}"}, json={"path": str(scan_folder)})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["unorganized_count"], 2)
        self.assertEqual(len(data["files"]), 2)

    def test_content_aware_organization_and_folder_capping(self):
        registered = self.client.post("/api/register", json={"username": "capper", "password": "capper-password"})
        token = registered.json()["token"]

        # 10 diverse files: 3 finance, 3 marketing/strategy, 2 legal/policy, 2 research
        files = [
            ("files", ("invoice_march.txt", b"invoice billing payment due tax total expense $400", "text/plain")),
            ("files", ("receipt_apple.txt", b"receipt purchase cost payment transaction card revenue", "text/plain")),
            ("files", ("q1_payroll.txt", b"payroll salary compensation employee accounting ledger", "text/plain")),
            ("files", ("q3_strategy.txt", b"pitch deck marketing strategy brand audience campaign roadmap", "text/plain")),
            ("files", ("growth_funnel.txt", b"marketing acquisition funnel audience launch conversion strategy", "text/plain")),
            ("files", ("competitor_deck.txt", b"presentation competitor analysis market vision deck slides", "text/plain")),
            ("files", ("terms_service.txt", b"terms of service agreement legal liability privacy compliance", "text/plain")),
            ("files", ("vendor_nda.txt", b"non-disclosure agreement contract clause signature confidential", "text/plain")),
            ("files", ("user_interview.txt", b"research interview study findings notes user feedback insights", "text/plain")),
            ("files", ("survey_report.txt", b"research study analysis survey report data findings methodology", "text/plain")),
        ]

        response = self.client.post("/api/organize", headers={"Authorization": f"Bearer {token}"}, files=files)
        self.assertEqual(response.status_code, 200)
        folder_count = int(response.headers["X-Folder-Count"])
        # Must NOT create too many folders (at most 4 folders for 10 files, never 10 folders)
        self.assertLessEqual(folder_count, 4)
        self.assertGreaterEqual(folder_count, 2)

        summary = json.loads(response.headers["X-Organization-Summary"])
        self.assertEqual(sum(f["count"] for f in summary), 10)
        # Verify no single-item folders when total files is 10
        for f in summary:
            self.assertGreaterEqual(f["count"], 2)

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest = json.loads(archive.read("organizer-manifest.json"))
            self.assertEqual(len(manifest), 10)
            for item in manifest:
                self.assertTrue(len(item["folder"]) > 0)
                self.assertTrue(len(item["reason"]) > 5)


if __name__ == "__main__":
    unittest.main()
