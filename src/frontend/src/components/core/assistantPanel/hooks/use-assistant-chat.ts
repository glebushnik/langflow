import { useStoreApi } from "@xyflow/react";
import { useCallback, useRef, useState } from "react";
import ShortUniqueId from "short-unique-id";
import { buildFlowPlanCanvasData } from "@/components/core/assistantPanel/helpers/flow-plan";
import {
  type AgenticFlowPlanResult,
  type AgenticStepType,
  postAssistStream,
} from "@/controllers/API/queries/agentic";
import { usePostValidateComponentCode } from "@/controllers/API/queries/nodes/use-post-validate-component-code";
import { useAddComponent } from "@/hooks/use-add-component";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useTypesStore } from "@/stores/typesStore";
import type { APIClassType } from "@/types/api";
import type {
  AssistantMessage,
  AssistantModel,
} from "../assistant-panel.types";

const uid = new ShortUniqueId();
const AGENTIC_SESSION_PREFIX = "agentic_";
const NULLISH_FLOW_ID_VALUES = new Set(["", "none", "null", "undefined"]);
const DEFAULT_CANVAS_NODE_WIDTH = 320;
const MINIMIZED_CANVAS_NODE_WIDTH = 192;

function normalizeFlowId(flowId: string | null | undefined): string | null {
  const normalized = flowId?.trim();
  if (!normalized) {
    return null;
  }

  if (NULLISH_FLOW_ID_VALUES.has(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function buildClarificationSummaryMessage(
  flowPlan: AgenticFlowPlanResult,
  answers: Record<string, string>,
): string {
  const clarificationLines = (
    flowPlan.interactive_clarifications.length > 0
      ? flowPlan.interactive_clarifications
      : flowPlan.clarifying_questions.map((question, index) => ({
          id: `clarification_${index + 1}`,
          question,
        }))
  )
    .map((clarification) => {
      const answer = answers[clarification.id];
      if (!answer) {
        return null;
      }
      return `- ${clarification.question}: ${answer}`;
    })
    .filter((line): line is string => Boolean(line));

  if (clarificationLines.length === 0) {
    return "Отправляю уточнения по flow.";
  }

  return ["Уточнения по flow:", ...clarificationLines].join("\n");
}

function buildClarificationRequest(
  flowPlan: AgenticFlowPlanResult,
  answers: Record<string, string>,
): string {
  const clarificationLines = (
    flowPlan.interactive_clarifications.length > 0
      ? flowPlan.interactive_clarifications
      : flowPlan.clarifying_questions.map((question, index) => ({
          id: `clarification_${index + 1}`,
          question,
        }))
  )
    .map((clarification) => {
      const answer = answers[clarification.id];
      if (!answer) {
        return null;
      }
      return `- ${clarification.question}\n  Ответ: ${answer}`;
    })
    .filter((line): line is string => Boolean(line));

  return [
    "Пересобери flow Langflow с учётом этих уточнений.",
    "Используй только stock-компоненты Langflow, без custom component и без Python-кода.",
    "Если после этих ответов данных всё ещё недостаточно, задай не более 3 новых уточняющих вопросов на русском языке.",
    "",
    `Исходный запрос пользователя: ${flowPlan.user_summary}`,
    "",
    "Уточнения:",
    ...clarificationLines,
  ].join("\n");
}

interface UseAssistantChatReturn {
  messages: AssistantMessage[];
  sessionId: string;
  isProcessing: boolean;
  currentStep: AgenticStepType | null;
  handleSend: (content: string, model: AssistantModel | null) => Promise<void>;
  handleApprove: (messageId: string, componentCode?: string) => Promise<void>;
  handleRetry: (messageId: string) => void;
  handleSubmitClarifications: (
    messageId: string,
    answers: Record<string, string>,
  ) => Promise<void>;
  handleStopGeneration: () => void;
  handleClearHistory: () => void;
  loadSession: (id: string, msgs: AssistantMessage[]) => void;
}

export function useAssistantChat(): UseAssistantChatReturn {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<AgenticStepType | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastModelRef = useRef<AssistantModel | null>(null);
  const sessionIdRef = useRef<string>(
    `${AGENTIC_SESSION_PREFIX}${uid.randomUUID(16)}`,
  );
  const [sessionId, setSessionId] = useState<string>(sessionIdRef.current);

  let reactFlowStore: ReturnType<typeof useStoreApi> | null = null;
  try {
    reactFlowStore = useStoreApi();
  } catch {
    reactFlowStore = null;
  }
  const currentFlowId = useFlowsManagerStore((state) => state.currentFlowId);
  const canvasNodes = useFlowStore((state) => state.nodes);
  const setNodes = useFlowStore((state) => state.setNodes);
  const setEdges = useFlowStore((state) => state.setEdges);
  const currentFlowLocked = useFlowStore((state) => state.currentFlow?.locked);
  const templates = useTypesStore((state) => state.templates);
  const addComponent = useAddComponent();
  const { mutateAsync: validateComponent } = usePostValidateComponentCode();

  const updateMessage = useCallback(
    (
      messageId: string,
      updater: (msg: AssistantMessage) => Partial<AssistantMessage>,
    ) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, ...updater(msg) } : msg,
        ),
      );
    },
    [],
  );

  const addGeneratedComponentToCanvas = useCallback(
    async (messageId: string, code: string) => {
      updateMessage(messageId, (msg) => ({
        result: {
          content: msg.result?.content ?? msg.content,
          validated: msg.result?.validated ?? true,
          className: msg.result?.className,
          componentCode: code,
          flowPlan: msg.result?.flowPlan,
          validationAttempts: msg.result?.validationAttempts,
          validationError: msg.result?.validationError,
          addingToCanvas: true,
          addedToCanvas: false,
          addToCanvasError: undefined,
        },
      }));

      try {
        // Backend builds the full frontend_node from code validation; empty placeholder is expected
        const response = await validateComponent({
          code,
          frontend_node: {} as APIClassType,
        });

        if (!response.data) {
          throw new Error("Assistant returned no component data");
        }

        addComponent(response.data, response.type || "CustomComponent");

        updateMessage(messageId, (msg) => ({
          result: {
            content: msg.result?.content ?? msg.content,
            validated: msg.result?.validated ?? true,
            className: msg.result?.className,
            componentCode: code,
            flowPlan: msg.result?.flowPlan,
            validationAttempts: msg.result?.validationAttempts,
            validationError: msg.result?.validationError,
            addingToCanvas: false,
            addedToCanvas: true,
            addToCanvasError: undefined,
          },
        }));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("Failed to validate or add component to canvas:", error);

        updateMessage(messageId, (msg) => ({
          result: {
            content: msg.result?.content ?? msg.content,
            validated: msg.result?.validated ?? true,
            className: msg.result?.className,
            componentCode: code,
            flowPlan: msg.result?.flowPlan,
            validationAttempts: msg.result?.validationAttempts,
            validationError: msg.result?.validationError,
            addingToCanvas: false,
            addedToCanvas: false,
            addToCanvasError: `Failed to add component: ${errorMessage}`,
          },
        }));
      }
    },
    [validateComponent, addComponent, updateMessage],
  );

  const addPlannedFlowToCanvas = useCallback(
    async (messageId: string) => {
      const message = messages.find((msg) => msg.id === messageId);
      const flowPlan = message?.result?.flowPlan;
      if (!flowPlan) {
        return;
      }

      updateMessage(messageId, (msg) => ({
        result: {
          content: msg.result?.content ?? msg.content,
          validated: false,
          flowPlan,
          addingToCanvas: true,
          addedToCanvas: false,
          addToCanvasError: undefined,
        },
      }));

      try {
        if (currentFlowLocked) {
          throw new Error("This flow is locked and cannot be edited.");
        }

        if (flowPlan.status !== "approval_required") {
          throw new Error(
            "This plan is not ready for implementation. Resolve the open questions first.",
          );
        }

        if (!Object.keys(templates).length) {
          throw new Error("Component templates are not loaded yet.");
        }

        const reactFlowState = reactFlowStore?.getState();
        const getCanvasNodeWidth = (node: (typeof canvasNodes)[number]) =>
          node.measured?.width ??
          node.width ??
          (node.data.showNode === false
            ? MINIMIZED_CANVAS_NODE_WIDTH
            : DEFAULT_CANVAS_NODE_WIDTH);
        const zoomLevel = reactFlowState?.transform?.[2] ?? 1;
        const zoomMultiplier = 1 / zoomLevel;
        const viewportWidth = reactFlowState?.width ?? 1440;
        const viewportHeight = reactFlowState?.height ?? 900;
        const centerX = reactFlowState
          ? -reactFlowState.transform[0] * zoomMultiplier +
            (viewportWidth * zoomMultiplier) / 2
          : 0;
        const centerY = reactFlowState
          ? -reactFlowState.transform[1] * zoomMultiplier +
            (viewportHeight * zoomMultiplier) / 2
          : 0;
        const maxExistingRight =
          canvasNodes.length > 0
            ? Math.max(
                ...canvasNodes.map(
                  (node) => node.position.x + getCanvasNodeWidth(node),
                ),
              )
            : centerX;
        const anchorX =
          canvasNodes.length > 0
            ? maxExistingRight + 104 * zoomMultiplier
            : centerX - viewportWidth * zoomMultiplier * 0.22;

        const { nodes, edges } = buildFlowPlanCanvasData({
          plan: flowPlan,
          templates,
          existingNodes: canvasNodes,
          anchor: {
            x: anchorX,
            y: centerY,
          },
          viewport: {
            width: viewportWidth * zoomMultiplier,
            height: viewportHeight * zoomMultiplier,
            centerX,
            centerY,
          },
          preferCentered: canvasNodes.length === 0,
        });

        if (nodes.length === 0 && edges.length === 0) {
          throw new Error(
            "The approved plan did not contain any canvas changes.",
          );
        }

        setNodes((oldNodes) => [
          ...oldNodes.map((node) => ({ ...node, selected: false })),
          ...nodes,
        ]);
        setEdges((oldEdges) => [
          ...oldEdges.map((edge) => ({ ...edge, selected: false })),
          ...edges,
        ]);

        updateMessage(messageId, (msg) => ({
          result: {
            content: msg.result?.content ?? msg.content,
            validated: false,
            flowPlan,
            addingToCanvas: false,
            addedToCanvas: true,
            addToCanvasError: undefined,
          },
        }));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("Failed to add planned flow to canvas:", error);

        updateMessage(messageId, (msg) => ({
          result: {
            content: msg.result?.content ?? msg.content,
            validated: false,
            flowPlan,
            addingToCanvas: false,
            addedToCanvas: false,
            addToCanvasError: `Failed to add flow: ${errorMessage}`,
          },
        }));
      }
    },
    [
      messages,
      canvasNodes,
      currentFlowLocked,
      reactFlowStore,
      setEdges,
      setNodes,
      templates,
      updateMessage,
    ],
  );

  const sendAssistantRequest = useCallback(
    async ({
      displayContent,
      requestContent,
      model,
    }: {
      displayContent: string;
      requestContent: string;
      model: AssistantModel | null;
    }): Promise<boolean> => {
      if (isProcessing) {
        return false;
      }

      if (!model?.provider || !model?.name) {
        return false;
      }

      const flowId = normalizeFlowId(currentFlowId);

      lastModelRef.current = model;

      const userMessage: AssistantMessage = {
        id: uid.randomUUID(10),
        role: "user",
        content: displayContent,
        timestamp: new Date(),
        status: "complete",
      };

      const assistantMessageId = uid.randomUUID(10);
      const assistantMessage: AssistantMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        status: "streaming",
      };

      if (!flowId) {
        setMessages((prev) => [
          ...prev,
          userMessage,
          {
            ...assistantMessage,
            status: "error",
            error:
              "Не удалось определить текущий flow. Откройте нужный flow и повторите запрос.",
          },
        ]);
        return false;
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsProcessing(true);

      abortControllerRef.current = new AbortController();

      const completedSteps: AgenticStepType[] = [];
      let currentStepTracked: AgenticStepType | null = null;

      try {
        await postAssistStream(
          {
            flow_id: flowId,
            input_value: requestContent,
            provider: model.provider,
            model_name: model.name,
            session_id: sessionIdRef.current,
          },
          {
            onProgress: (event) => {
              if (currentStepTracked && event.step !== currentStepTracked) {
                completedSteps.push(currentStepTracked);
              }
              currentStepTracked = event.step;

              setCurrentStep(event.step);
              updateMessage(assistantMessageId, (msg) => ({
                progress: {
                  step: event.step,
                  attempt: event.attempt,
                  maxAttempts: event.max_attempts,
                  message: event.message,
                  error: event.error,
                  className: event.class_name ?? msg.progress?.className,
                  componentCode:
                    event.component_code ?? msg.progress?.componentCode,
                },
                completedSteps: [...completedSteps],
              }));
            },
            onToken: (event) => {
              updateMessage(assistantMessageId, (msg) => ({
                content: msg.content + event.chunk,
              }));
            },
            onComplete: (event) => {
              const shouldAutoAdd = Boolean(
                event.data.validated && event.data.component_code,
              );
              const isFlowPlan = Boolean(event.data.flow_plan);

              updateMessage(assistantMessageId, () => ({
                status: "complete" as const,
                content: event.data.result || "",
                ...(isFlowPlan && { progress: undefined }),
                result: {
                  content: event.data.result || "",
                  validated: event.data.validated,
                  className: event.data.class_name,
                  componentCode: event.data.component_code,
                  flowPlan: event.data.flow_plan,
                  validationAttempts: event.data.validation_attempts,
                  validationError: event.data.validation_error,
                  addingToCanvas: shouldAutoAdd,
                  addedToCanvas: false,
                  addToCanvasError: undefined,
                },
              }));
              setCurrentStep(null);
              setIsProcessing(false);

              if (shouldAutoAdd && event.data.component_code) {
                void addGeneratedComponentToCanvas(
                  assistantMessageId,
                  event.data.component_code,
                );
              }
            },
            onError: (event) => {
              updateMessage(assistantMessageId, () => ({
                status: "error" as const,
                error: event.message,
              }));
              setCurrentStep(null);
              setIsProcessing(false);
            },
            onCancelled: () => {
              updateMessage(assistantMessageId, () => ({
                status: "cancelled" as const,
                progress: undefined,
              }));
              setCurrentStep(null);
              setIsProcessing(false);
            },
          },
          abortControllerRef.current.signal,
        );
        return true;
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          updateMessage(assistantMessageId, () => ({
            status: "error" as const,
            error: "Не удалось подключиться к ассистенту",
          }));
        }
        setCurrentStep(null);
        setIsProcessing(false);
        return false;
      }
    },
    [isProcessing, currentFlowId, updateMessage, addGeneratedComponentToCanvas],
  );

  const handleSend = useCallback(
    async (content: string, model: AssistantModel | null) => {
      await sendAssistantRequest({
        displayContent: content,
        requestContent: content,
        model,
      });
    },
    [sendAssistantRequest],
  );

  const handleApprove = useCallback(
    async (messageId: string, componentCode?: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message?.result?.flowPlan) {
        await addPlannedFlowToCanvas(messageId);
        return;
      }

      const code = componentCode || message?.result?.componentCode;
      if (!code) return;

      await addGeneratedComponentToCanvas(messageId, code);
    },
    [messages, addGeneratedComponentToCanvas, addPlannedFlowToCanvas],
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      // Find the failed assistant message and the user message before it
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex < 1) return;

      const userMessage = messages
        .slice(0, msgIndex)
        .reverse()
        .find((m) => m.role === "user");
      if (!userMessage?.content || !lastModelRef.current) return;

      // Remove the failed assistant message so a fresh one is created by handleSend
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      handleSend(userMessage.content, lastModelRef.current);
    },
    [messages, handleSend],
  );

  const handleSubmitClarifications = useCallback(
    async (messageId: string, answers: Record<string, string>) => {
      const message = messages.find((item) => item.id === messageId);
      const flowPlan = message?.result?.flowPlan;
      const model = lastModelRef.current;

      if (!flowPlan || !model) {
        throw new Error(
          "Не удалось подготовить уточнения для перепланирования.",
        );
      }

      const started = await sendAssistantRequest({
        displayContent: buildClarificationSummaryMessage(flowPlan, answers),
        requestContent: buildClarificationRequest(flowPlan, answers),
        model,
      });

      if (!started) {
        throw new Error("Не удалось отправить уточнения. Попробуйте ещё раз.");
      }
    },
    [messages, sendAssistantRequest],
  );

  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();

    setMessages((prev) =>
      prev.map((msg) =>
        msg.status === "streaming"
          ? {
              ...msg,
              status: "cancelled" as const,
              progress: undefined,
            }
          : msg,
      ),
    );
    setCurrentStep(null);
    setIsProcessing(false);
  }, []);

  const handleClearHistory = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setCurrentStep(null);
    setIsProcessing(false);
    const newId = `${AGENTIC_SESSION_PREFIX}${uid.randomUUID(16)}`;
    sessionIdRef.current = newId;
    setSessionId(newId);
  }, []);

  const loadSession = useCallback((id: string, msgs: AssistantMessage[]) => {
    abortControllerRef.current?.abort();
    setMessages(msgs);
    setCurrentStep(null);
    setIsProcessing(false);
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  return {
    messages,
    sessionId,
    isProcessing,
    currentStep,
    handleSend,
    handleApprove,
    handleRetry,
    handleSubmitClarifications,
    handleStopGeneration,
    handleClearHistory,
    loadSession,
  };
}
