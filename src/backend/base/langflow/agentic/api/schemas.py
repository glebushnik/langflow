"""Request and response schemas for the Assistant API."""

from typing import Any, Literal

from pydantic import BaseModel, Field

# All possible step types for SSE progress events
StepType = Literal[
    "generating",  # LLM is generating response
    "planning_flow",  # Planning a stock component flow
    "generating_component",  # LLM is generating component code
    "generation_complete",  # LLM finished generating
    "extracting_code",  # Extracting Python code from response
    "validating",  # Validating component code
    "validated",  # Validation succeeded
    "validation_failed",  # Validation failed
    "retrying",  # About to retry with error context
]


class AssistantRequest(BaseModel):
    """Request model for assistant interactions."""

    flow_id: str
    component_id: str | None = None
    field_name: str | None = None
    input_value: str | None = Field(None, max_length=2000)
    max_retries: int | None = Field(None, ge=1, le=5)
    model_name: str | None = None
    provider: str | None = None
    session_id: str | None = None


class ValidationResult(BaseModel):
    """Result of component code validation."""

    is_valid: bool
    code: str | None = None
    error: str | None = None
    class_name: str | None = None


class FlowPlanCostEstimate(BaseModel):
    """Approximate planning-token cost summary for a proposed flow."""

    tier: Literal["low", "medium", "high"]
    prompt_tokens: int = Field(ge=0)
    completion_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=0)
    note: str


class FlowPlanCatalogSummary(BaseModel):
    """Metadata about the stock component catalog used for planning."""

    total_stock_components: int = Field(ge=0)
    total_categories: int = Field(ge=0)
    shortlisted_components: list[str] = Field(default_factory=list)


class FlowPlanClarificationOption(BaseModel):
    """A suggested answer option for an interactive clarification step."""

    label: str
    value: str


class FlowPlanInteractiveClarification(BaseModel):
    """A single interactive clarification question for the business user."""

    id: str
    question: str
    options: list[FlowPlanClarificationOption] = Field(
        default_factory=list,
        min_length=2,
        max_length=2,
    )
    input_placeholder: str | None = None


class FlowPlanComponent(BaseModel):
    """A single stock Langflow component proposed for the flow."""

    id: str
    component_name: str
    display_name: str | None = None
    category: str | None = None
    purpose: str
    field_values: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class FlowPlanConnection(BaseModel):
    """A typed connection between two proposed components."""

    source_id: str
    source_output: str
    target_id: str
    target_field: str
    description: str | None = None


class FlowPlanResult(BaseModel):
    """Approval-ready build_flow planning result."""

    status: Literal["approval_required", "needs_clarification", "unsupported"]
    title: str
    summary: str
    user_summary: str
    approval_message: str
    data_flow_steps: list[str] = Field(default_factory=list)
    components: list[FlowPlanComponent] = Field(default_factory=list)
    connections: list[FlowPlanConnection] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    clarifying_questions: list[str] = Field(default_factory=list)
    clarification_intro: str | None = None
    interactive_clarifications: list[FlowPlanInteractiveClarification] = Field(default_factory=list)
    cost_estimate: FlowPlanCostEstimate | None = None
    catalog_summary: FlowPlanCatalogSummary | None = None
