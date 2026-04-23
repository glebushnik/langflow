"""Helpers for validating and normalizing assistant flow IDs."""

_NULLISH_FLOW_ID_VALUES = {"", "none", "null", "undefined"}


def normalize_flow_id(flow_id: str | None) -> str | None:
    """Return a cleaned flow_id or ``None`` for null-like values."""
    if flow_id is None:
        return None

    normalized = flow_id.strip()
    if normalized.lower() in _NULLISH_FLOW_ID_VALUES:
        return None

    return normalized
