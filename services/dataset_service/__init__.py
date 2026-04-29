try:
    from .services.asset_service import AssetService
    from .services.project_service import ProjectService
    from .services.version_manager import VersionManager
except ImportError:
    pass
