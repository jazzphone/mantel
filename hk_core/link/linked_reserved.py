"""What a linked entity never takes from Mantel: the attributes Home Assistant sets itself.

Shared by HK Frontend (linked_mode.py) and Mantel Link (entity.py), whose Linked* entity classes mirror Mantel's entities
in Home Assistant. Only this is exactly the same in both; the classes build on a LinkedEntity that differs (see
docs/phase24/SHARED-REPORT.md).
"""
from __future__ import annotations

# attributes Home Assistant itself sets: never taken from Mantel's
_RESERVED = {"friendly_name", "icon", "entity_picture", "supported_features", "device_class",
             "unit_of_measurement", "assumed_state", "attribution", "restored", "state_class", "options",
             "access_token", "code_format", "code_arm_required", "frontend_stream_type", "entity_id"}
