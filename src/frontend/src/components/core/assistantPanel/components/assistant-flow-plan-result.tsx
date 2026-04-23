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
import { useEffect, useMemo, useState } from "react";
import type { AgenticResult } from "@/controllers/API/queries/agentic";

interface AssistantFlowPlanResultProps {
  result: AgenticResult;
  onApprove: () => void;
  onSubmitClarifications?: (answers: Record<string, string>) => Promise<void>;
}

const COST_TIER_LABELS = {
  low: "Низкая оценка токенов",
  medium: "Средняя оценка токенов",
  high: "Высокая оценка токенов",
} as const;

export function AssistantFlowPlanResult({
  result,
  onApprove,
  onSubmitClarifications,
}: AssistantFlowPlanResultProps) {
  const flowPlan = result.flowPlan;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [manualAnswer, setManualAnswer] = useState("");
  const [clarificationError, setClarificationError] = useState<string | null>(
    null,
  );
  const [isSubmittingClarifications, setIsSubmittingClarifications] =
    useState(false);

  useEffect(() => {
    setAnswers({});
    setManualAnswer("");
    setClarificationError(null);
    setIsSubmittingClarifications(false);
  }, [flowPlan?.title, flowPlan?.summary, flowPlan?.clarification_intro]);

  const interactiveClarifications = flowPlan?.interactive_clarifications ?? [];
  const currentClarification = useMemo(
    () =>
      interactiveClarifications.find(
        (clarification) => !answers[clarification.id],
      ),
    [answers, interactiveClarifications],
  );

  if (!flowPlan) {
    return null;
  }

  const canApprove = flowPlan.status === "approval_required";
  const isAddingToCanvas = Boolean(result.addingToCanvas);
  const wasAddedToCanvas = Boolean(result.addedToCanvas);
  const addToCanvasError = result.addToCanvasError;
  const cost = flowPlan.cost_estimate;
  const hasInteractiveClarifications =
    flowPlan.status === "needs_clarification" &&
    interactiveClarifications.length > 0;
  const answeredCount = interactiveClarifications.filter(
    (clarification) => answers[clarification.id],
  ).length;

  const submitClarifications = async (nextAnswers: Record<string, string>) => {
    if (!onSubmitClarifications) {
      return;
    }

    setIsSubmittingClarifications(true);
    try {
      await onSubmitClarifications(nextAnswers);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось отправить уточнения. Попробуйте ещё раз.";
      setClarificationError(message);
    } finally {
      setIsSubmittingClarifications(false);
    }
  };

  const handleClarificationAnswer = async (answer: string) => {
    if (!currentClarification || !onSubmitClarifications) {
      return;
    }

    const normalizedAnswer = answer.trim();
    if (!normalizedAnswer) {
      return;
    }

    const nextAnswers = {
      ...answers,
      [currentClarification.id]: normalizedAnswer,
    };

    setAnswers(nextAnswers);
    setManualAnswer("");
    setClarificationError(null);

    const isLastQuestion =
      answeredCount + 1 >= interactiveClarifications.length;
    if (!isLastQuestion) {
      return;
    }

    await submitClarifications(nextAnswers);
  };

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
                {COST_TIER_LABELS[cost.tier]}
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
            <span>Кратко для бизнеса</span>
          </div>
          <p className="text-sm text-foreground">{flowPlan.user_summary}</p>
        </div>

        {flowPlan.data_flow_steps.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Поток данных
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
              Стоковые компоненты
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
              Допущения
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
              <span>Предупреждения</span>
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

        {hasInteractiveClarifications && (
          <div className="rounded-xl border border-border/60 bg-background/50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Уточняющие вопросы
            </div>

            {flowPlan.clarification_intro && (
              <p className="mb-3 text-sm text-foreground">
                {flowPlan.clarification_intro}
              </p>
            )}

            {interactiveClarifications
              .filter((clarification) => answers[clarification.id])
              .map((clarification, index) => (
                <div
                  key={clarification.id}
                  className="mb-3 rounded-xl border border-border/60 bg-muted/30 p-3"
                >
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Ответ {index + 1}
                  </div>
                  <p className="text-sm text-foreground">
                    {clarification.question}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {answers[clarification.id]}
                  </p>
                </div>
              ))}

            {currentClarification && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Вопрос {answeredCount + 1} из{" "}
                  {interactiveClarifications.length}
                </div>
                <p className="mb-3 text-sm text-foreground">
                  {currentClarification.question}
                </p>

                <div className="grid gap-2 sm:grid-cols-2">
                  {currentClarification.options.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className="rounded-xl border border-border/70 bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                      disabled={isSubmittingClarifications}
                      onClick={() =>
                        void handleClarificationAnswer(option.value)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={manualAnswer}
                    onChange={(event) => setManualAnswer(event.target.value)}
                    placeholder={
                      currentClarification.input_placeholder ||
                      "Введите свой вариант ответа"
                    }
                    disabled={isSubmittingClarifications}
                    className="h-10 flex-1 rounded-xl border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && manualAnswer.trim()) {
                        event.preventDefault();
                        void handleClarificationAnswer(manualAnswer);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={
                      isSubmittingClarifications ||
                      manualAnswer.trim().length === 0
                    }
                    onClick={() => void handleClarificationAnswer(manualAnswer)}
                  >
                    {answeredCount + 1 >= interactiveClarifications.length
                      ? "Отправить ответы"
                      : "Продолжить"}
                  </button>
                </div>
              </div>
            )}

            {!currentClarification && isSubmittingClarifications && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Пересобираю flow с учётом уточнений...</span>
              </div>
            )}

            {clarificationError && (
              <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{clarificationError}</span>
                </div>
                {!currentClarification && (
                  <button
                    type="button"
                    className="mt-2 inline-flex h-8 items-center rounded-lg border border-destructive/30 px-3 text-xs font-medium transition-colors hover:bg-destructive/10"
                    onClick={() => void submitClarifications(answers)}
                  >
                    Повторить отправку
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!hasInteractiveClarifications &&
          flowPlan.clarifying_questions.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-background/50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Уточняющие вопросы
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
              <span>Оценка стоимости</span>
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
              <span>Добавлено на canvas</span>
            </div>
          ) : isAddingToCanvas ? (
            <div className="flex h-8 items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Добавляю на canvas...</span>
            </div>
          ) : canApprove ? (
            <button
              type="button"
              data-testid="assistant-approve-flow-plan-button"
              className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100"
              onClick={onApprove}
            >
              {addToCanvasError && <RefreshCcw className="h-3.5 w-3.5" />}
              {addToCanvasError
                ? "Повторить"
                : "Подтвердить и добавить на canvas"}
            </button>
          ) : (
            <div className="text-sm text-muted-foreground">
              Сначала ответьте на уточняющие вопросы.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
