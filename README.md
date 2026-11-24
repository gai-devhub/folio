# Folio — context file organizer

Folio has five pages: Register, Login, Dashboard, Uploads, and Organized. The UI is Next.js with TypeScript in `frontend/`. The API is FastAPI in `backend/`, with route handlers under `routes/` and file analysis under `services/`. MySQL stores accounts and organization history. Upload contents are processed in memory and returned as a ZIP.

## Quick Start Commands

### Run Backend (FastAPI + Local MySQL)
Run with your system Python (no `.venv` needed):
```sh
cd backend
/opt/homebrew/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Health check endpoint: `http://localhost:8000/api/health`

### Run Frontend (Next.js 15)
```sh
cd frontend
npm start
# or for hot reloading: npm run dev
```
Open in browser: `http://localhost:3000`

## Run locally

1. Make sure your existing local MySQL server is running. Copy `.env.example` to `.env` and set the MySQL connection values and a long random `ORGANIZER_SECRET`.
2. Create the database once in MySQL if it does not exist: `CREATE DATABASE file_organizer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` The app creates its tables at startup.
3. Start FastAPI using the installed Python; no virtual environment is created:

   ```sh
   cd backend
   /opt/homebrew/bin/python3 -m pip install -r requirements.txt
   /opt/homebrew/bin/python3 -m uvicorn main:app --reload --port 8000
   ```

   If the requirements are already installed for that interpreter, skip the `pip install` line. The API creates its MySQL tables automatically during startup. To initialize the tables separately, run `/opt/homebrew/bin/python3 init_db.py` from `backend/`.

4. In another terminal, run the Next.js frontend:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`. API health is at `http://localhost:8000/api/health`.

## Pages

- `/register` — username, password, and `checkboss` preference.
- `/login` — account sign in.
- `/dashboard` — activity totals and recent organization results.
- `/uploads` — upload files or choose a folder after granting browser access.
- `/organized` — review folder groups and download the ZIP.

Websites cannot silently scan Desktop or Downloads. The browser folder picker requires a user to choose the folder. The optional local-folder API operates on the machine running FastAPI and should only be exposed to a trusted local user.

## Organization & AI Intelligence

Folio reads and extracts text from PPTX, PDF, DOCX, TXT, Markdown, CSV, JSON, and LOG files:
- **Intelligent Folder Capping**: Avoids folder sprawl by capping total folders to an intuitive, manageable number (typically 2 to 4 folders for normal batches, at most 5 for large sets). Outlier single-file fragments are automatically consolidated into matching categories or general references so you never end up with 1 folder per file.
- **Smart Thematic Analysis**: Categorizes based on document contents across domains like Finance & Accounting, Marketing & Presentations, Contracts & Legal, Research & Insights, Engineering & Tech, and Operations.
- **Optional Gemini LLM**: To use Google Gemini to organize your files using an LLM, simply add `GEMINI_API_KEY=your_key_here` to your `.env` file. Folio will send the file summaries to Gemini 1.5 Flash to group them and provide detailed context reasons. If no key is set or the network is offline, the built-in smart clustering engine organizes everything locally with zero external dependencies.

The downloadable ZIP contains the folders and `organizer-manifest.json` with context reasons for each file. Upload limit is 50 MB per request.

## Test

Use the already-installed Python interpreter:

```sh
cd backend
/opt/homebrew/bin/python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Build and type-check Next.js:

```sh
cd frontend
npm run build
```

`.vscode/settings.json` selects `/opt/homebrew/bin/python3`, adds `backend/` for imports, and configures unittest discovery. It does not create a venv.
