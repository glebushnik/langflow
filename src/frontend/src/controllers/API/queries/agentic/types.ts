export type AgenticStepType =
  | "generating"
  | "planning_flow"
  | "generating_component"
  | "generation_complete"
  | "extracting_code"
  | "validating"
  | "validated"
  | "validation_failed"
  | "retrying";

export interface AgenticProgressEvent {
  event: "progress";
  step: AgenticStepType;
  attempt: number;
  max_attempts: number;
  message?: string;
  error?: string;
  class_name?: string;
  component_code?: string;
}

export interface AgenticTokenEvent {
  event: "token";
  chunk: string;
}

export interface AgenticCompleteData {
  result: string;
  validated: boolean;
  class_name?: string;
  component_code?: string;
  validation_attempts?: number;
  validation_error?: string;
  flow_plan?: AgenticFlowPlanResult;
}

export interface AgenticCompleteEvent {
  event: "complete";
  data: AgenticCompleteData;
}

export interface AgenticErrorEvent {
  event: "error";
  message: string;
}

export interface AgenticCancelledEvent {
  event: "cancelled";
  message: string;
}

export type AgenticSSEEvent =
  | AgenticProgressEvent
  | AgenticTokenEvent
  | AgenticCompleteEvent
  | AgenticErrorEvent
  | AgenticCancelledEvent;

export interface AgenticAssistRequest {
  flow_id: string;
  input_value: string;
  model_name?: string;
  provider?: string;
  max_retries?: number;
  session_id?: string;
}

export interface AgenticFlowPlanCostEstimate {
  tier: "low" | "medium" | "high";
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  note: string;
}

export interface AgenticFlowPlanCatalogSummary {
  total_stock_components: number;
  total_categories: number;
  shortlisted_components: string[];
}

export interface AgenticFlowPlanClarificationOption {
  label: string;
  value: string;
}

export interface AgenticFlowPlanInteractiveClarification {
  id: string;
  question: string;
  options: AgenticFlowPlanClarificationOption[];
  input_placeholder?: string;
}

export interface AgenticFlowPlanComponent {
  id: string;
  component_name: string;
  display_name?: string;
  category?: string;
  purpose: string;
  field_values: Record<string, unknown>;
  notes?: string;
}

export interface AgenticFlowPlanConnection {
  source_id: string;
  source_output: string;
  target_id: string;
  target_field: string;
  description?: string;
}

export interface AgenticFlowPlanResult {
  status: "approval_required" | "needs_clarification" | "unsupported";
  title: string;
  summary: string;
  user_summary: string;
  approval_message: string;
  data_flow_steps: string[];
  components: AgenticFlowPlanComponent[];
  connections: AgenticFlowPlanConnection[];
  assumptions: string[];
  warnings: string[];
  clarifying_questions: string[];
  clarification_intro?: string;
  interactive_clarifications: AgenticFlowPlanInteractiveClarification[];
  cost_estimate?: AgenticFlowPlanCostEstimate;
  catalog_summary?: AgenticFlowPlanCatalogSummary;
}

export interface AgenticProgressState {
  step: AgenticStepType;
  attempt: number;
  maxAttempts: number;
  message?: string;
  error?: string;
  className?: string;
  componentCode?: string;
}

export interface AgenticResult {
  content: string;
  validated: boolean;
  className?: string;
  componentCode?: string;
  flowPlan?: AgenticFlowPlanResult;
  validationError?: string;
  validationAttempts?: number;
  addingToCanvas?: boolean;
  addedToCanvas?: boolean;
  addToCanvasError?: string;
}
