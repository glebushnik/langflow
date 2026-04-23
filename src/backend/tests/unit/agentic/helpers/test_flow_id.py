"""Tests for flow_id normalization helpers."""

from langflow.agentic.helpers.flow_id import normalize_flow_id


class TestNormalizeFlowId:
    """Tests for normalize_flow_id."""

    def test_should_return_none_for_nullish_values(self):
        """Null-like strings should be treated as missing flow IDs."""
        for value in (None, "", "   ", "None", "null", "undefined"):
            assert normalize_flow_id(value) is None

    def test_should_strip_and_preserve_real_values(self):
        """Real flow IDs should be preserved after trimming whitespace."""
        assert normalize_flow_id("  flow-123  ") == "flow-123"
