"""Clean Areas' constants (the option keys are the shared logic's: hk_core/clean_areas.py)."""

from ...hk_core.clean_areas import CONF_AREAS, CONF_VACUUMS  # noqa: F401 -- re-exported

SIGNAL_CHANGED = "hk_clean_areas_changed"   # the settings changed: the pickers ask again
SERVICE_CLEAN = "clean_areas"               # hk_frontend.clean_areas
