import {
  AlertCircle,
  Check,
  FileStack,
  Loader2,
  MessageSquareQuote,
  MoveRight,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import type { AgenticResult } from "@/controllers/API/queries/agentic";

interface AssistantFlowPlanResultProps {
  result: AgenticResult;
  onApprove: () => void;
}

export function AssistantFlowPlanResult({
  result,
  onApprove,
}: AssistantFlowPlanResultProps) {
  const flowPlan = result.flowPlan;

  if (!flowPlan) {
    return null;
  }

  const canApprove = flowPlan.status === "approval_required";
  const isAddingToCanvas = Boolean(result.addingToCanvas);
  const wasAddedToCanvas = Boolean(result.addedToCanvas);
  const addToCanvasError = result.addToCanvasError;
  const cost = flowPlan.cost_estimate;

  return (
    <div
      data-testid="assistant-flow-plan-result"
      className="max-w-[92%] rounded-[1.25rem] border border-border/70 bg-muted/30 p-4 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.55)] backdrop-blur-sm"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#0F766E]">
          <FileStack className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {flowPlan.title}
            </span>
            {cost && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {cost.tier} token cost
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {flowPlan.summary}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border/60 bg-background/50 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessageSquareQuote className="h-3.5 w-3.5" />
            <span>Business Summary</span>
          </div>
          <p className="text-sm text-foreground">{flowPlan.user_summary}</p>
        </div>

        {flowPlan.data_flow_steps.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Data Flow
            </div>
            <div className="space-y-2">
              {flowPlan.data_flow_steps.map((step, index) => (
                <div
                  key={`${step}-${index}`}
                  className="flex items-start gap-2"
                >
                  <MoveRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-sm text-foreground">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {flowPlan.components.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Stock Components
            </div>
            <div className="flex flex-wrap gap-1.5">
              {flowPlan.components.map((component) => (
                <span
                  key={component.id}
                  className="rounded bg-background/70 px-2 py-1 text-xs text-foreground"
                  title={component.purpose}
                >
                  {component.display_name || component.component_name}
                </span>
              ))}
            </div>
          </div>
        )}

        {flowPlan.assumptions.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assumptions
            </div>
            <div className="space-y-1.5">
              {flowPlan.assumptions.map((assumption, index) => (
                <p
                  key={`${assumption}-${index}`}
                  className="text-sm text-foreground"
                >
                  {assumption}
                </p>
              ))}
            </div>
          </div>
        )}

        {flowPlan.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Warnings</span>
            </div>
            <div className="space-y-1.5">
              {flowPlan.warnings.map((warning, index) => (
                <p
                  key={`${warning}-${index}`}
                  className="text-sm text-amber-800 dark:text-amber-100"
                >
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        {flowPlan.clarifying_questions.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-background/50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Clarifying Questions
            </div>
            <div className="space-y-1.5">
              {flowPlan.clarifying_questions.map((question, index) => (
                <p
                  key={`${question}-${index}`}
                  className="text-sm text-foreground"
                >
                  {question}
                </p>
              ))}
            </div>
          </div>
        )}

        {cost && (
          <div className="rounded-xl border border-border/60 bg-background/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Planning Cost</span>
            </div>
            <p className="text-sm text-foreground">{cost.note}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {addToCanvasError && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{addToCanvasError}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {wasAddedToCanvas ? (
            <div className="flex h-8 items-center gap-1.5 text-sm font-medium text-accent-emerald-foreground">
              <Check className="h-4 w-4" />
              <span>Added to Canvas</span>
            </div>
          ) : isAddingToCanvas ? (
            <div className="flex h-8 items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Adding to Canvas...</span>
            </div>
          ) : canApprove ? (
            <button
              type="button"
              data-testid="assistant-approve-flow-plan-button"
              className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100"
              onClick={onApprove}
            >
              {addToCanvasError && <RefreshCcw className="h-3.5 w-3.5" />}
              {addToCanvasError ? "Try Again" : "Approve and Add to Canvas"}
            </button>
          ) : (
            <div className="text-sm text-muted-foreground">
              Approval is blocked until the open questions are resolved.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
