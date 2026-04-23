import type { AssistantSuggestion } from "./assistant-panel.types";

export const ASSISTANT_TITLE = "Ассистент-Копилот";

export const ASSISTANT_SESSION_STORAGE_KEY_PREFIX =
  "langflow-assistant-session-";

export const ASSISTANT_PLACEHOLDERS = [
  "Создать компонент агента...",
  "Построить пайплайн RAG...",
  "Создать компонент для парсера веб-страниц...",
  "Создать парсер документов...",
  "Спросить что угодно про Langflow...",
];

export function getAssistantPlaceholder(): string {
  return ASSISTANT_PLACEHOLDERS[
    Math.floor(Math.random() * ASSISTANT_PLACEHOLDERS.length)
  ];
}

export const ASSISTANT_SESSIONS_STORAGE_KEY = "langflow-assistant-sessions";
export const ASSISTANT_MAX_SESSIONS = 10;
export const ASSISTANT_SESSION_PREVIEW_LENGTH = 80;

export const ASSISTANT_WELCOME_TEXT = "Чем могу помочь";

export const ASSISTANT_SUGGESTIONS: AssistantSuggestion[] = [
  {
    id: "build-agents",
    icon: "Sparkles",
    text: "Создать агентов и другие компоненты",
  },
  {
    id: "answer-questions",
    icon: "Sparkles",
    text: "Ответить на вопросы про Langflow",
  },
];
