from routes.auth import router as auth_router
from routes.dashboard import router as dashboard_router
from routes.local_folders import router as local_folders_router
from routes.organize import router as organize_router

__all__ = ["auth_router", "organize_router", "local_folders_router", "dashboard_router"]
