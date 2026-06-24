try:
    from .services.inference_service import InferenceLogic, kpi_clients, record_kpi_events
except ImportError:
    pass
