"""Initialize the MySQL schema without starting the FastAPI server."""

from database import init_db

init_db()
print("Folio MySQL tables are ready.")
