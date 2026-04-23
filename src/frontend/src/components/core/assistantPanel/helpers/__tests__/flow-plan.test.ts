import type { AgenticFlowPlanResult } from "@/controllers/API/queries/agentic";
import type { APIClassType } from "@/types/api";
import {
  buildFlowPlanCanvasData,
  estimateFlowPlanNodeDimensions,
} from "../flow-plan";

function createTemplate(
  displayName: string,
  fields: Array<{
    name: string;
    type: string;
    show?: boolean;
    multiline?: boolean;
    inputTypes?: string[];
  }>,
  outputs: string[],
  options?: {
    description?: string;
    minimized?: boolean;
  },
): APIClassType {
  return {
    display_name: displayName,
    description: options?.description ?? `${displayName} description`,
    minimized: options?.minimized ?? false,
    template: {
      _type: "Component",
      ...Object.fromEntries(
        fields.map((field) => [
          field.name,
          {
            name: field.name,
            display_name: field.name,
            type: field.type,
            show: field.show ?? true,
            multiline: field.multiline ?? false,
            input_types: field.inputTypes ?? [],
            value: "",
          },
        ]),
      ),
    },
    outputs: outputs.map((outputName) => ({
      name: outputName,
      display_name: outputName,
      types: ["Message"],
    })),
  } as APIClassType;
}

describe("flow-plan helper", () => {
  it("should estimate compact but non-zero dimensions for minimized and expanded nodes", () => {
    const minimized = createTemplate("Chat Input", [], ["message"], {
      minimized: true,
    });
    const expanded = createTemplate(
      "Language Model",
      [
        { name: "model", type: "model", inputTypes: ["LanguageModel"] },
        { name: "input_value", type: "str", inputTypes: ["Message"] },
        { name: "system_message", type: "str", multiline: true },
        { name: "temperature", type: "slider" },
      ],
      ["text_output"],
    );

    expect(estimateFlowPlanNodeDimensions(minimized)).toEqual({
      width: 192,
      height: 52,
    });
    expect(estimateFlowPlanNodeDimensions(expanded).width).toBe(320);
    expect(estimateFlowPlanNodeDimensions(expanded).height).toBeGreaterThan(
      176,
    );
  });

  it("should place sibling nodes in the same column without overlapping", () => {
    const templates = {
      ChatInput: createTemplate(
        "Chat Input",
        [{ name: "input_value", type: "str", multiline: true }],
        ["message"],
      ),
      LanguageModelComponent: createTemplate(
        "Language Model",
        [
          { name: "model", type: "model", inputTypes: ["LanguageModel"] },
          { name: "input_value", type: "str", inputTypes: ["Message"] },
          { name: "system_message", type: "str", multiline: true },
          { name: "temperature", type: "slider" },
          { name: "stream", type: "bool" },
        ],
        ["text_output"],
      ),
      ChatOutput: createTemplate(
        "Chat Output",
        [{ name: "input_value", type: "other", inputTypes: ["Message"] }],
        ["message"],
      ),
    } satisfies Record<string, APIClassType>;
    const plan: AgenticFlowPlanResult = {
      status: "approval_required",
      title: "Диалоговый flow",
      summary: "Отвечает пользователю и определяет тему.",
      user_summary:
        "Создай мне flow, который отвечает на вопрос пользователя и называет тему диалога.",
      approval_message: "Подтвердите добавление flow.",
      data_flow_steps: [],
      assumptions: [],
      warnings: [],
      clarifying_questions: [],
      cost_estimate: undefined,
      catalog_summary: undefined,
      components: [
        {
          id: "chat_input",
          component_name: "ChatInput",
          purpose: "Принимает вопрос пользователя.",
          field_values: {},
        },
        {
          id: "answer_llm",
          component_name: "LanguageModelComponent",
          purpose: "Отвечает на вопрос пользователя.",
          field_values: {
            system_message: "Отвечай на вопрос пользователя по-русски.",
          },
        },
        {
          id: "topic_llm",
          component_name: "LanguageModelComponent",
          purpose: "Определяет тему диалога.",
          field_values: {
            system_message: "Определи тему диалога и назови ее по-русски.",
          },
        },
        {
          id: "chat_output_answer",
          component_name: "ChatOutput",
          purpose: "Показывает основной ответ.",
          field_values: {},
        },
        {
          id: "chat_output_topic",
          component_name: "ChatOutput",
          purpose: "Показывает тему диалога.",
          field_values: {},
        },
      ],
      connections: [
        {
          source_id: "chat_input",
          source_output: "message",
          target_id: "answer_llm",
          target_field: "input_value",
        },
        {
          source_id: "chat_input",
          source_output: "message",
          target_id: "topic_llm",
          target_field: "input_value",
        },
        {
          source_id: "answer_llm",
          source_output: "text_output",
          target_id: "chat_output_answer",
          target_field: "input_value",
        },
        {
          source_id: "topic_llm",
          source_output: "text_output",
          target_id: "chat_output_topic",
          target_field: "input_value",
        },
      ],
    };

    const { nodes } = buildFlowPlanCanvasData({
      plan,
      templates,
      existingNodes: [],
      anchor: { x: 200, y: 400 },
      viewport: { width: 1200, height: 800, centerX: 600, centerY: 400 },
      preferCentered: true,
    });

    const llmNodes = nodes
      .filter((node) => node.data.type === "LanguageModelComponent")
      .sort((left, right) => left.position.y - right.position.y);

    expect(llmNodes).toHaveLength(2);
    expect(llmNodes[0].position.x).toBe(llmNodes[1].position.x);
    expect(llmNodes[0].measured?.height).toBeGreaterThan(0);
    expect(llmNodes[1].position.y).toBeGreaterThanOrEqual(
      llmNodes[0].position.y + (llmNodes[0].height ?? 0),
    );
  });
});
