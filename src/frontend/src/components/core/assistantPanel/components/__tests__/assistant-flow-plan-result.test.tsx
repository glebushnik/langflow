import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantFlowPlanResult } from "../assistant-flow-plan-result";

const buildResult = () => ({
  content: "Нужно уточнить детали flow",
  validated: false,
  flowPlan: {
    status: "needs_clarification" as const,
    title: "Нужно уточнение",
    summary: "Нужно уточнить источник данных и формат результата.",
    user_summary: "Собери flow для подготовки отчётов.",
    approval_message: "После уточнений я предложу flow.",
    data_flow_steps: ["Данные поступают в flow и готовится итоговый ответ."],
    components: [],
    connections: [],
    assumptions: [],
    warnings: [],
    clarifying_questions: [
      "Откуда именно нужно брать данные?",
      "В каком формате нужен результат?",
    ],
    clarification_intro:
      "Ответьте на два коротких вопроса. Можно выбрать готовый вариант или написать свой.",
    interactive_clarifications: [
      {
        id: "source",
        question: "Откуда именно нужно брать данные?",
        options: [
          {
            label: "Публичные URL",
            value:
              "Используйте публичные URL-адреса как основной источник данных.",
          },
          {
            label: "Локальные файлы",
            value: "Используйте локальные файлы как основной источник данных.",
          },
        ],
        input_placeholder: "Напишите свой источник данных",
      },
      {
        id: "format",
        question: "В каком формате нужен результат?",
        options: [
          {
            label: "Текстовая сводка",
            value: "Верните итог в виде текстовой сводки.",
          },
          {
            label: "JSON",
            value: "Верните итог в формате JSON.",
          },
        ],
        input_placeholder: "Опишите нужный формат результата",
      },
    ],
    cost_estimate: {
      tier: "low" as const,
      prompt_tokens: 1200,
      completion_tokens: 300,
      total_tokens: 1500,
      note: "Примерная стоимость планирования ассистентом: ~1200 входных токенов и ~300 выходных токенов.",
    },
  },
});

describe("AssistantFlowPlanResult", () => {
  it("should render russian sections and submit clarifications sequentially", async () => {
    const onSubmitClarifications = jest.fn().mockResolvedValue(undefined);

    render(
      <AssistantFlowPlanResult
        result={buildResult()}
        onApprove={jest.fn()}
        onSubmitClarifications={onSubmitClarifications}
      />,
    );

    expect(screen.getByText("Кратко для бизнеса")).toBeInTheDocument();
    expect(screen.getByText("Поток данных")).toBeInTheDocument();
    expect(screen.getByText("Уточняющие вопросы")).toBeInTheDocument();
    expect(screen.getByText("Оценка стоимости")).toBeInTheDocument();
    expect(screen.getByText("Вопрос 1 из 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Публичные URL" }));

    expect(screen.getByText("Ответ 1")).toBeInTheDocument();
    expect(screen.getByText("Вопрос 2 из 2")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Опишите нужный формат результата"),
      {
        target: { value: "Нужен CSV-файл с краткой сводкой." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответы" }));

    await waitFor(() => {
      expect(onSubmitClarifications).toHaveBeenCalledWith({
        source:
          "Используйте публичные URL-адреса как основной источник данных.",
        format: "Нужен CSV-файл с краткой сводкой.",
      });
    });
  });
});
