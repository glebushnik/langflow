"""Stock flow planner for build_flow assistant requests."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Literal

from lfx.base.models.model_metadata import get_provider_param_mapping
from lfx.cli.script_loader import extract_structured_result
from lfx.components.input_output import ChatInput, ChatOutput
from lfx.components.models import LanguageModelComponent
from lfx.graph import Graph
from lfx.log.logger import logger
from lfx.schema.schema import InputValueRequest
from pydantic import BaseModel, Field, ValidationError

from langflow.agentic.api.schemas import (
    FlowPlanCatalogSummary,
    FlowPlanClarificationOption,
    FlowPlanComponent,
    FlowPlanConnection,
    FlowPlanCostEstimate,
    FlowPlanInteractiveClarification,
    FlowPlanResult,
)
from langflow.agentic.helpers.flow_id import normalize_flow_id
from langflow.agentic.utils.component_search import list_all_components

_PLANNER_COMPLETION_BUDGET = 1800
_MAX_COMPONENTS_IN_PROMPT = 36
_MAX_CLARIFICATION_ROUNDS = 3
_MAX_FIELDS_PER_COMPONENT = 14
_MAX_OUTPUTS_PER_COMPONENT = 4
_DEFAULT_VALUE_PREVIEW_LIMIT = 60
_LOW_COST_TOKEN_THRESHOLD = 3000
_MEDIUM_COST_TOKEN_THRESHOLD = 8000
_MAX_CLARIFICATION_QUESTIONS = 3
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?```", re.DOTALL)
_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}", re.DOTALL)
_NULLISH_FIELD_VALUES = {"", "none", "null", "undefined"}
_PRIORITY_FIELD_NAMES = {
    "model",
    "system_message",
    "system_prompt",
    "instructions",
    "format_instructions",
    "template",
    "prompt",
    "input_value",
    "search_query",
    "knowledge_base",
    "collection_name",
    "chunk_size",
    "chunk_overlap",
    "text_key",
    "separator",
    "top_k",
    "number_of_results",
    "limit",
    "mode",
}
_INSTRUCTION_FIELD_NAMES = {
    "system_message",
    "system_prompt",
    "instructions",
    "format_instructions",
    "template",
    "prompt",
}
_RESOURCE_NAME_STOPWORDS = {
    "a",
    "an",
    "and",
    "assistant",
    "build",
    "create",
    "dialog",
    "flow",
    "for",
    "from",
    "in",
    "into",
    "langflow",
    "pipeline",
    "system",
    "that",
    "the",
    "to",
    "user",
    "with",
}

_MANDATORY_COMPONENTS = {
    "ChatInput",
    "ChatOutput",
    "LanguageModelComponent",
    "EmbeddingModel",
    "File",
    "Directory",
    "SplitText",
    "TypeConverterComponent",
    "CombineText",
    "Prompt Template",
    "KnowledgeBase",
    "KnowledgeIngestion",
    "LocalDB",
    "Chroma",
    "QdrantVectorStoreComponent",
    "pgvector",
    "Milvus",
    "CohereRerank",
    "NvidiaRerankComponent",
}
_CUSTOM_COMPONENT_TYPES = {"custom_component", "deactivated"}
_VECTOR_STORE_HINTS = {
    "postgres": "pgvector",
    "pgvector": "pgvector",
    "qdrant": "QdrantVectorStoreComponent",
    "chroma": "Chroma",
    "milvus": "Milvus",
    "local": "LocalDB",
}


@dataclass(slots=True)
class _CatalogComponent:
    name: str
    display_name: str
    category: str
    description: str
    inputs: list[dict[str, Any]]
    outputs: list[dict[str, Any]]
    aliases: set[str]
    searchable_text: str


class _InteractiveClarificationPayload(BaseModel):
    clarification_intro: str
    interactive_clarifications: list[FlowPlanInteractiveClarification] = Field(
        default_factory=list,
        min_length=1,
        max_length=_MAX_CLARIFICATION_QUESTIONS,
    )


_catalog_cache: tuple[list[_CatalogComponent], dict[str, _CatalogComponent]] | None = None


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _estimate_tokens(text: str) -> int:
    """Heuristic token estimate that is stable across providers."""
    if not text:
        return 0
    try:
        import tiktoken  # type: ignore[import-not-found]

        return len(tiktoken.get_encoding("cl100k_base").encode(text))
    except Exception:  # noqa: BLE001
        return math.ceil(len(text) / 4)


def _build_model_config(provider: str, model_name: str) -> list[dict[str, Any]]:
    param_mapping = get_provider_param_mapping(provider)
    metadata: dict[str, Any] = {
        "api_key_param": param_mapping.get("api_key_param", "api_key"),
        "context_length": 128000,
        "model_class": param_mapping.get("model_class", "ChatOpenAI"),
        "model_name_param": param_mapping.get("model_name_param", "model"),
    }
    for extra_param in ("url_param", "project_id_param", "base_url_param"):
        if extra_param in param_mapping:
            metadata[extra_param] = param_mapping[extra_param]
    return [
        {
            "icon": provider,
            "metadata": metadata,
            "name": model_name,
            "provider": provider,
        }
    ]


def _get_component_aliases(
    component_name: str,
    display_name: str,
    template_type: str | None,
) -> set[str]:
    aliases = {component_name, display_name}
    if template_type:
        aliases.add(template_type)
        if template_type.endswith("Component"):
            aliases.add(template_type.removesuffix("Component"))
    if component_name.endswith("Component"):
        aliases.add(component_name.removesuffix("Component"))
    return {_normalize_key(alias) for alias in aliases if alias}


def _summarize_default_value(value: Any) -> str | int | float | bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        normalized = value.strip().replace("\n", "\\n")
        if not normalized:
            return None
        return normalized[:_DEFAULT_VALUE_PREVIEW_LIMIT] + (
            "..." if len(normalized) > _DEFAULT_VALUE_PREVIEW_LIMIT else ""
        )
    if isinstance(value, list):
        return None if not value else f"[{len(value)} items]"
    if isinstance(value, dict):
        return None if not value else "{...}"
    return None


def _simplify_input_fields(template: dict[str, Any]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for key, value in template.items():
        if key in {"code", "_type"} or not isinstance(value, dict):
            continue
        fields.append(
            {
                "name": key,
                "display_name": value.get("display_name") or key,
                "type": value.get("type") or value.get("_input_type") or "unknown",
                "input_types": value.get("input_types") or [],
                "required": bool(value.get("required", False)),
                "show": bool(value.get("show", False)),
                "advanced": bool(value.get("advanced", False)),
                "multiline": bool(value.get("multiline", False)),
                "default": _summarize_default_value(value.get("value")),
            }
        )
    fields.sort(
        key=lambda item: (
            item["required"] is False,
            item["name"] not in _PRIORITY_FIELD_NAMES,
            item["show"] is False,
            item["advanced"] is True,
            item["name"],
        )
    )
    return fields[:_MAX_FIELDS_PER_COMPONENT]


def _simplify_outputs(outputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    simplified = [
        {
            "name": output.get("name"),
            "display_name": output.get("display_name") or output.get("name"),
            "types": output.get("types") or [],
        }
        for output in outputs
        if output.get("name")
    ]
    return simplified[:_MAX_OUTPUTS_PER_COMPONENT]


async def _get_stock_catalog() -> tuple[list[_CatalogComponent], dict[str, _CatalogComponent]]:
    global _catalog_cache  # noqa: PLW0603
    if _catalog_cache is not None:
        return _catalog_cache

    raw_components = await list_all_components(fields=["display_name", "description", "template", "outputs", "flow"])

    catalog: list[_CatalogComponent] = []
    lookup: dict[str, _CatalogComponent] = {}

    for component in raw_components:
        component_type = str(component.get("type") or "")
        if component_type in _CUSTOM_COMPONENT_TYPES:
            continue
        if component.get("flow"):
            continue

        template = component.get("template") or {}
        outputs = component.get("outputs") or []
        display_name = component.get("display_name") or component["name"]
        aliases = _get_component_aliases(
            component_name=component["name"],
            display_name=display_name,
            template_type=template.get("_type"),
        )
        inputs = _simplify_input_fields(template)
        simplified_outputs = _simplify_outputs(outputs)
        searchable_text = " ".join(
            [
                component["name"],
                display_name,
                component_type,
                str(component.get("description") or ""),
                " ".join(field["name"] for field in inputs),
                " ".join(output["name"] for output in simplified_outputs),
            ]
        ).lower()

        catalog_component = _CatalogComponent(
            name=component["name"],
            display_name=display_name,
            category=component_type,
            description=str(component.get("description") or ""),
            inputs=inputs,
            outputs=simplified_outputs,
            aliases=aliases,
            searchable_text=searchable_text,
        )
        catalog.append(catalog_component)
        for alias in aliases:
            lookup[alias] = catalog_component

    catalog.sort(key=lambda item: (item.category, item.name))
    _catalog_cache = (catalog, lookup)
    return _catalog_cache


def _score_component(component: _CatalogComponent, translated_request: str) -> int:
    request_text = translated_request.lower()
    request_terms = {
        token
        for token in re.findall(r"[a-zA-Z0-9_]{3,}", request_text)
        if token not in {"that", "with", "from", "into", "flow", "langflow"}
    }
    score = 0

    if component.name in _MANDATORY_COMPONENTS:
        score += 5

    for term in request_terms:
        if term in component.searchable_text:
            score += 3
        if term in component.name.lower():
            score += 4
        if term in component.display_name.lower():
            score += 4

    if ("rag" in request_text or "retrieval" in request_text) and component.name in {
        "KnowledgeBase",
        "KnowledgeIngestion",
        "SplitText",
        "LocalDB",
        "Chroma",
        "QdrantVectorStoreComponent",
        "pgvector",
        "Milvus",
        "CohereRerank",
        "NvidiaRerankComponent",
        "TypeConverterComponent",
        "CombineText",
    }:
        score += 12

    if any(token in request_text for token in ("pdf", "document", "docs", "doc", "ocr")) and (
        component.name in {"File", "Directory", "Unstructured", "DoclingInline", "DoclingRemote"}
    ):
        score += 12

    if any(token in request_text for token in ("chat", "assistant", "question", "q&a", "qa")) and (
        component.name in {"ChatInput", "ChatOutput", "LanguageModelComponent"}
    ):
        score += 10

    for hint, preferred in _VECTOR_STORE_HINTS.items():
        if hint in request_text and component.name == preferred:
            score += 18

    if ("rerank" in request_text or "reranker" in request_text) and component.name in {
        "CohereRerank",
        "NvidiaRerankComponent",
    }:
        score += 18

    return score


def _shortlist_components(
    catalog: list[_CatalogComponent],
    translated_request: str,
) -> list[_CatalogComponent]:
    scored = sorted(
        catalog,
        key=lambda component: (-_score_component(component, translated_request), component.name),
    )

    shortlisted: list[_CatalogComponent] = []
    seen: set[str] = set()

    for component in scored:
        score = _score_component(component, translated_request)
        if component.name in _MANDATORY_COMPONENTS or score > 0:
            shortlisted.append(component)
            seen.add(component.name)
        if len(shortlisted) >= _MAX_COMPONENTS_IN_PROMPT:
            break

    if len(shortlisted) < min(_MAX_COMPONENTS_IN_PROMPT, len(catalog)):
        for component in catalog:
            if component.name in seen:
                continue
            shortlisted.append(component)
            if len(shortlisted) >= _MAX_COMPONENTS_IN_PROMPT:
                break

    return shortlisted


def _render_catalog_for_prompt(components: list[_CatalogComponent]) -> str:
    def _render_field(field: dict[str, Any]) -> str:
        qualifiers: list[str] = []
        if field["required"]:
            qualifiers.append("required")
        elif field["show"]:
            qualifiers.append("visible")
        if field["multiline"]:
            qualifiers.append("multiline")
        if field["input_types"]:
            qualifiers.append(f"accepts={'/'.join(field['input_types'])}")
        if field.get("default") is not None:
            qualifiers.append(f"default={field['default']}")
        return f"{field['name']}:{field['type']}" + (f" ({'; '.join(qualifiers)})" if qualifiers else "")

    lines: list[str] = []
    for component in components:
        inputs = ", ".join(_render_field(field) for field in component.inputs)
        outputs = ", ".join(
            f"{output['name']}:{'/'.join(output['types']) or 'unknown'}" for output in component.outputs
        )
        lines.append(
            f"- {component.name} | display={component.display_name} | category={component.category} | "
            f"description={component.description or 'n/a'} | inputs={inputs or 'n/a'} | "
            f"outputs={outputs or 'n/a'}"
        )
    return "\n".join(lines)


def _build_planner_prompt(
    *,
    original_request: str,
    translated_request: str,
    catalog: list[_CatalogComponent],
    clarification_round: int = 0,
) -> str:
    schema_json = json.dumps(FlowPlanResult.model_json_schema(), ensure_ascii=False)

    if clarification_round == 0:
        round_instruction = (
            "MANDATORY OVERRIDE: This is the FIRST planning request. "
            "You MUST return `status=needs_clarification` with 1-3 focused clarifying questions. "
            "Do NOT return `approval_required` even if the request seems clear enough. "
            "Ask about data sources, expected output format, or specific integrations needed.\n\n"
        )
    elif clarification_round >= _MAX_CLARIFICATION_ROUNDS:
        round_instruction = (
            "MANDATORY OVERRIDE: The user has already answered clarifying questions "
            f"{clarification_round} time(s). "
            "You MUST return `status=approval_required` with a complete implementation plan. "
            "Do NOT return `needs_clarification` — no more questions allowed.\n\n"
        )
    else:
        round_instruction = ""

    return (
        f"{round_instruction}"
        "You are the Langflow stock flow planner.\n"
        "Your job is to convert a business request into a minimal Langflow chain built only from stock components.\n\n"
        "Rules:\n"
        "1. Use only components from the provided catalog.\n"
        "2. Never propose custom components, Python code, MCP servers, or nonexistent nodes.\n"
        "3. Prefer the smallest chain that still solves the request.\n"
        "4. Assume the user is non-technical. Explain the data flow in plain language.\n"
        "5. Treat trolling, abusive, or very vague requests as needs_clarification or unsupported.\n"
        "6. If the user asks for a RAG/reporting/document flow, separate ingestion "
        "and answer-time blocks when useful.\n"
        "7. Use exact `component_name`, exact `source_output`, and exact `target_field` values from the catalog.\n"
        "8. `field_values` may contain only real template fields from the catalog and should stay minimal.\n"
        "9. Always ask for approval before implementation through `approval_message`.\n"
        "10. ALL human-facing text MUST be in Russian — title, summary, user_summary, "
        "approval_message, data_flow_steps, assumptions, warnings, purpose, notes, "
        "and every string value inside field_values (system_message, system_prompt, template, "
        "prompt, format_instructions, etc.).\n"
        "11. Keep ONLY these in their original English/technical form: component_name values, "
        "field key names (e.g. system_message, collection_name), file extension parts (.txt, .json), "
        "and URLs. Everything else is Russian.\n"
        "12. For each component, set `display_name` to a SHORT (2-5 words) RUSSIAN name that "
        "describes that component's specific ROLE in this flow (not the generic component type). "
        "Example: instead of 'Language Model', write 'Анализ отзывов'; instead of 'Write File', "
        "write 'Сохранение отчёта'.\n"
        "13. Set `purpose` to a clear Russian sentence explaining what this component does in the flow.\n"
        "14. If a component has instruction-bearing fields (system_message, system_prompt, template, "
        "prompt, format_instructions), fill them with concrete Russian instructions for this task.\n"
        "15. Never leave an active LLM or prompt component without explicit Russian instructions.\n"
        "14. When a storage/retrieval component needs an identifier such as `knowledge_base` or "
        "`collection_name`, provide one.\n"
        "15. Do not rely on hidden frontend defaults for critical behavior. Fill the fields that make the "
        "pipeline understandable and executable.\n\n"
        f"Original user request:\n{original_request}\n\n"
        f"English translation of the request:\n{translated_request}\n\n"
        f"Available stock component catalog ({len(catalog)} shortlisted entries):\n"
        f"{_render_catalog_for_prompt(catalog)}\n\n"
        "Output requirements:\n"
        "- Return JSON only.\n"
        "- `status` must be one of: approval_required, needs_clarification, unsupported.\n"
        "- If `status=approval_required`, include a usable component chain and connections.\n"
        "- If `status=needs_clarification`, keep components/connections empty and ask 1-3 focused questions.\n"
        "- If `status=unsupported`, explain why stock components are insufficient.\n\n"
        f"JSON schema:\n{schema_json}"
    )


def _build_clarification_prompt(
    *,
    original_request: str,
    translated_request: str,
    plan: FlowPlanResult,
) -> str:
    schema_json = json.dumps(_InteractiveClarificationPayload.model_json_schema(), ensure_ascii=False)
    questions_block = "\n".join(
        f"{index}. {question}"
        for index, question in enumerate(plan.clarifying_questions[:_MAX_CLARIFICATION_QUESTIONS], start=1)
    )
    return (
        "You convert stock-flow clarification questions into an interactive Russian assistant wizard.\n"
        "The user is a non-technical business stakeholder.\n\n"
        "Rules:\n"
        "1. Keep ALL text strictly in Russian — question, label, value, input_placeholder, "
        "clarification_intro. No English words allowed.\n"
        "2. Preserve the intent of the clarification questions.\n"
        "3. Return at most 3 questions.\n"
        "4. For each question, produce EXACTLY 2 concise suggested options (no more, no fewer).\n"
        "5. Each option: `label` is a short 2-4 word button text in Russian; `value` is a complete "
        "sentence in Russian that will be sent to the planner as the user's answer.\n"
        "6. `input_placeholder` is a short Russian hint for free-form input on every question.\n"
        "7. Keep options practical and non-technical.\n"
        "8. Return only JSON — no markdown, no explanations, no code blocks.\n\n"
        f"Original user request:\n{original_request}\n\n"
        f"English translation of the request:\n{translated_request}\n\n"
        f"Flow title:\n{plan.title}\n\n"
        f"Flow summary:\n{plan.summary}\n\n"
        f"Clarifying questions to transform:\n{questions_block}\n\n"
        f"JSON schema:\n{schema_json}"
    )


def _extract_json_payload(response_text: str) -> dict[str, Any]:
    stripped = response_text.strip()
    for candidate in (stripped,):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    block_match = _JSON_BLOCK_RE.search(response_text)
    if block_match:
        return json.loads(block_match.group(1).strip())

    object_match = _JSON_OBJECT_RE.search(response_text)
    if object_match:
        return json.loads(object_match.group(0))

    error_message = "Planner response did not contain valid JSON"
    raise ValueError(error_message)


def _has_meaningful_field_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        normalized = value.strip()
        return bool(normalized) and normalized.lower() not in _NULLISH_FIELD_VALUES
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _truncate_text(value: str, limit: int = 220) -> str:
    normalized = " ".join(value.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _build_cost_note(
    *,
    prompt_tokens: int,
    completion_tokens: int,
    runtime_drivers: list[str],
) -> str:
    note = (
        "Примерная стоимость планирования ассистентом: "
        f"~{prompt_tokens} входных токенов и ~{completion_tokens} выходных токенов. "
    )
    if runtime_drivers:
        note += "После подтверждения основные драйверы runtime-стоимости: " + ", ".join(runtime_drivers) + "."
    else:
        note += "После подтверждения runtime-стоимость в основном зависит от подключенных провайдеров."
    return note


def _get_cost_tier(total_tokens: int) -> Literal["low", "medium", "high"]:
    if total_tokens < _LOW_COST_TOKEN_THRESHOLD:
        return "low"
    if total_tokens < _MEDIUM_COST_TOKEN_THRESHOLD:
        return "medium"
    return "high"


def _get_runtime_drivers(component_names: set[str]) -> list[str]:
    runtime_drivers: list[str] = []
    if "File" in component_names or "Directory" in component_names:
        runtime_drivers.append("парсинг файлов и OCR на ingestion-слое")
    if component_names & {"EmbeddingModel", "OpenAIEmbeddings", "AzureOpenAIEmbeddings", "CohereEmbeddings"}:
        runtime_drivers.append("генерация эмбеддингов")
    if component_names & {"LocalDB", "Chroma", "QdrantVectorStoreComponent", "pgvector", "Milvus"}:
        runtime_drivers.append("векторный поиск")
    if component_names & {"CohereRerank", "NvidiaRerankComponent"}:
        runtime_drivers.append("переранжирование")
    if component_names & {"LanguageModelComponent", "OpenAIModel", "AnthropicModel", "GroqModel"}:
        runtime_drivers.append("генерация ответа через LLM")
    return runtime_drivers


def _build_default_clarifying_questions(original_request: str) -> list[str]:
    lowered_request = original_request.lower()
    questions = [
        "Откуда именно нужно брать данные для этого flow?",
        "В каком формате пользователь должен получать итоговый результат?",  # noqa: RUF001
    ]
    if any(token in lowered_request for token in ("данн", "document", "doc", "rag", "report", "отчет", "отчёт")):
        questions.append("Есть ли у вас уже готовые данные для проверки, или нужен тестовый набор?")  # noqa: RUF001
    return questions[:_MAX_CLARIFICATION_QUESTIONS]


def _build_fallback_clarification(
    question: str,
    index: int,
) -> FlowPlanInteractiveClarification:
    normalized_question = question.strip()
    lowered_question = normalized_question.lower()

    if any(token in lowered_question for token in ("тест", "готов", "sample", "example", "генератор", "demo")):
        options = [
            FlowPlanClarificationOption(
                label="Есть готовые данные",
                value="У меня уже есть готовые данные для проверки этого flow.",  # noqa: RUF001
            ),
            FlowPlanClarificationOption(
                label="Нужен тестовый набор",
                value="Нужно использовать тестовые данные или генератор данных.",
            ),
        ]
        input_placeholder = "Опишите, какие данные использовать для теста"
    elif any(
        token in lowered_question
        for token in ("откуда", "источник", "url", "api", "file", "файл", "база", "данные", "source")
    ):
        options = [
            FlowPlanClarificationOption(
                label="Публичные URL",
                value="Используйте публичные URL-адреса как основной источник данных.",
            ),
            FlowPlanClarificationOption(
                label="Локальные файлы",
                value="Используйте локальные файлы как основной источник данных.",
            ),
        ]
        input_placeholder = "Напишите свой источник данных: URL, файлы, БД или API"
    elif any(
        token in lowered_question
        for token in ("формат", "результат", "output", "json", "таблиц", "сводк", "визуализ", "visual")
    ):
        options = [
            FlowPlanClarificationOption(
                label="Текстовая сводка",
                value="Верните итоговый результат в виде текстовой сводки.",
            ),
            FlowPlanClarificationOption(
                label="JSON",
                value="Верните итоговый результат в формате JSON для дальнейшей обработки.",
            ),
        ]
        input_placeholder = "Опишите нужный формат результата"
    elif any(token in lowered_question for token in ("когда", "распис", "trigger", "schedule", "часто", "запуск")):
        options = [
            FlowPlanClarificationOption(
                label="По запросу",
                value="Запускайте flow только по запросу пользователя.",
            ),
            FlowPlanClarificationOption(
                label="По расписанию",
                value="Запускайте flow автоматически по расписанию.",
            ),
        ]
        input_placeholder = "Опишите, когда именно нужно запускать flow"
    else:
        options = [
            FlowPlanClarificationOption(
                label="Базовый вариант",
                value="Подойдёт стандартный вариант без сложной дополнительной настройки.",
            ),
            FlowPlanClarificationOption(
                label="Свой сценарий",
                value="Нужен кастомный сценарий с более точной настройкой под мой процесс.",  # noqa: RUF001
            ),
        ]
        input_placeholder = "Введите свой вариант ответа"

    return FlowPlanInteractiveClarification(
        id=f"clarification_{index + 1}",
        question=normalized_question or f"Уточняющий вопрос {index + 1}",
        options=options,
        input_placeholder=input_placeholder,
    )


def _build_fallback_interactive_clarifications(
    questions: list[str],
) -> tuple[str, list[FlowPlanInteractiveClarification]]:
    intro = (
        "Чтобы собрать корректный flow без лишних компонентов, ответьте на несколько коротких вопросов. "
        "Можно выбрать готовый вариант или ввести свой."
    )
    interactive_questions = [
        _build_fallback_clarification(question, index)
        for index, question in enumerate(questions[:_MAX_CLARIFICATION_QUESTIONS])
    ]
    return intro, interactive_questions


def _sanitize_interactive_clarifications(
    clarifications: list[FlowPlanInteractiveClarification],
    fallback_questions: list[str],
) -> list[FlowPlanInteractiveClarification]:
    sanitized: list[FlowPlanInteractiveClarification] = []
    for index, clarification in enumerate(clarifications[:_MAX_CLARIFICATION_QUESTIONS]):
        options = clarification.options[:2]
        if len(options) != 2:  # noqa: PLR2004
            continue
        fallback_question = (
            fallback_questions[index] if index < len(fallback_questions) else f"Уточняющий вопрос {index + 1}"
        )
        sanitized.append(
            FlowPlanInteractiveClarification(
                id=clarification.id or f"clarification_{index + 1}",
                question=clarification.question.strip() or fallback_question,
                options=[
                    FlowPlanClarificationOption(
                        label=option.label.strip(),
                        value=option.value.strip(),
                    )
                    for option in options
                ],
                input_placeholder=clarification.input_placeholder or "Введите свой вариант ответа",
            )
        )

    if len(sanitized) >= len(fallback_questions):
        return sanitized

    sanitized.extend(
        _build_fallback_clarification(fallback_questions[index], index)
        for index in range(len(sanitized), len(fallback_questions))
    )

    return sanitized[:_MAX_CLARIFICATION_QUESTIONS]


def _build_resource_name(title: str, translated_request: str) -> str:
    seed = translated_request or title
    tokens = [token for token in re.findall(r"[a-z0-9]+", seed.lower()) if token not in _RESOURCE_NAME_STOPWORDS]
    if not tokens and title:
        tokens = re.findall(r"[a-z0-9]+", title.lower())
    slug = "_".join(tokens[:4]).strip("_")
    return (slug or "assistant_flow")[:48]


def _build_default_system_message(
    *,
    component_purpose: str,
    flow_title: str,
    original_request: str,
) -> str:
    purpose = component_purpose.strip().rstrip(".") or "выполни задачу этого узла"
    lower_purpose = purpose.lower()
    instructions = [
        "Ты — отдельный LLM-узел внутри flow Langflow.",
        f"Твоя задача: {purpose}.",
    ]
    if flow_title:
        instructions.append(f"Сценарий flow: {_truncate_text(flow_title, 80)}.")
    if original_request:
        instructions.append(f"Бизнес-запрос пользователя: {_truncate_text(original_request, 220)}.")
    instructions.extend(
        [
            "Используй только данные, которые приходят в этот узел.",
            "Не описывай внутреннюю архитектуру flow и не упоминай технические детали реализации.",  # noqa: RUF001
            "Дай готовый результат без лишних рассуждений.",
            "Отвечай по-русски.",
        ]
    )
    if "тема" in lower_purpose or "topic" in lower_purpose:
        instructions.append("Если нужно определить тему диалога, обязательно явно назови тему.")
    return " ".join(instructions)


def _field_accepts_language_model(field_spec: dict[str, Any] | None) -> bool:
    if not field_spec:
        return False
    return field_spec.get("type") == "model" and "LanguageModel" in (field_spec.get("input_types") or [])


def _has_valid_language_model_config(value: Any) -> bool:
    if not isinstance(value, list) or not value:
        return False
    return all(isinstance(item, dict) and bool(item.get("name")) and bool(item.get("provider")) for item in value)


def _enrich_component_field_values(
    *,
    component_purpose: str,
    field_values: dict[str, Any],
    catalog_component: _CatalogComponent,
    original_request: str,
    translated_request: str,
    provider: str | None,
    model_name: str | None,
    flow_title: str,
) -> tuple[dict[str, Any], list[str]]:
    field_specs = {field["name"]: field for field in catalog_component.inputs}
    field_values = dict(field_values)
    assumptions: list[str] = []
    resource_name = _build_resource_name(flow_title, translated_request)

    model_field = field_specs.get("model")
    if (
        _field_accepts_language_model(model_field)
        and not _has_valid_language_model_config(field_values.get("model"))
        and provider
        and model_name
    ):
        field_values["model"] = _build_model_config(provider, model_name)
        assumptions.append(
            f"Компонент '{catalog_component.display_name}' будет использовать выбранную модель {provider}/{model_name}."
        )

    if "system_message" in field_specs and not _has_meaningful_field_value(field_values.get("system_message")):
        field_values["system_message"] = _build_default_system_message(
            component_purpose=component_purpose,
            flow_title=flow_title,
            original_request=original_request,
        )
        assumptions.append(
            f"Для компонента '{catalog_component.display_name}' автоматически сформирован `system_message`."
        )

    if "system_prompt" in field_specs and not _has_meaningful_field_value(field_values.get("system_prompt")):
        field_values["system_prompt"] = _build_default_system_message(
            component_purpose=component_purpose,
            flow_title=flow_title,
            original_request=original_request,
        )
        assumptions.append(
            f"Для компонента '{catalog_component.display_name}' автоматически сформирован `system_prompt`."
        )

    if "collection_name" in field_specs and not _has_meaningful_field_value(field_values.get("collection_name")):
        field_values["collection_name"] = resource_name
        assumptions.append(
            f"Для компонента '{catalog_component.display_name}' задан `collection_name={resource_name}`."
        )

    if "knowledge_base" in field_specs and not _has_meaningful_field_value(field_values.get("knowledge_base")):
        knowledge_base_name = f"{resource_name}_kb"
        field_values["knowledge_base"] = knowledge_base_name
        assumptions.append(
            f"Для компонента '{catalog_component.display_name}' задан `knowledge_base={knowledge_base_name}`."
        )

    return field_values, assumptions


def _collect_missing_critical_fields(
    component: FlowPlanComponent,
    catalog_component: _CatalogComponent,
) -> list[str]:
    field_specs = {field["name"]: field for field in catalog_component.inputs}
    missing: list[str] = []

    if _field_accepts_language_model(field_specs.get("model")) and not _has_valid_language_model_config(
        component.field_values.get("model")
    ):
        missing.append("model")

    missing.extend(
        instruction_field
        for instruction_field in ("system_message", "system_prompt")
        if instruction_field in field_specs
        and not _has_meaningful_field_value(component.field_values.get(instruction_field))
    )

    template_field = field_specs.get("template")
    if (
        template_field
        and template_field.get("type") == "prompt"
        and not _has_meaningful_field_value(component.field_values.get("template"))
    ):
        missing.append("template")

    missing.extend(
        resource_field
        for resource_field in ("collection_name", "knowledge_base")
        if resource_field in field_specs and not _has_meaningful_field_value(component.field_values.get(resource_field))
    )

    return missing


def _canonicalize_plan(
    raw_plan: FlowPlanResult,
    lookup: dict[str, _CatalogComponent],
    *,
    original_request: str,
    translated_request: str,
    provider: str | None,
    model_name: str | None,
    total_stock_components: int,
    total_categories: int,
    shortlisted_components: list[_CatalogComponent],
    prompt_tokens: int,
    completion_tokens: int,
) -> FlowPlanResult:
    canonical_components: list[FlowPlanComponent] = []
    component_specs: dict[str, _CatalogComponent] = {}
    assumptions = list(raw_plan.assumptions)
    warnings = list(raw_plan.warnings)
    seen_assumptions = set(assumptions)

    for component in raw_plan.components:
        catalog_component = lookup.get(_normalize_key(component.component_name))
        if catalog_component is None:
            warnings.append(
                f"Компонент '{component.component_name}' недоступен как stock-компонент и был удалён из плана."
            )
            continue

        input_names = {field["name"] for field in catalog_component.inputs}
        sanitized_values = {key: value for key, value in component.field_values.items() if key in input_names}
        warnings.extend(
            f"Поле '{key}' было проигнорировано для компонента '{catalog_component.display_name}'."
            for key in component.field_values
            if key not in input_names
        )

        enriched_values, inferred_assumptions = _enrich_component_field_values(
            component_purpose=component.purpose,
            field_values=sanitized_values,
            catalog_component=catalog_component,
            original_request=original_request,
            translated_request=translated_request,
            provider=provider,
            model_name=model_name,
            flow_title=raw_plan.title,
        )
        for assumption in inferred_assumptions:
            if assumption not in seen_assumptions:
                assumptions.append(assumption)
                seen_assumptions.add(assumption)

        canonical_component = FlowPlanComponent(
            id=component.id,
            component_name=catalog_component.name,
            display_name=component.display_name or catalog_component.display_name,
            category=catalog_component.category,
            purpose=component.purpose,
            field_values=enriched_values,
            notes=component.notes,
        )
        canonical_components.append(canonical_component)
        component_specs[component.id] = catalog_component

    canonical_connections: list[FlowPlanConnection] = []
    for connection in raw_plan.connections:
        source_spec = component_specs.get(connection.source_id)
        target_spec = component_specs.get(connection.target_id)
        if source_spec is None or target_spec is None:
            warnings.append(
                "Одна из связей ссылалась на компонент, которого нет в финальном плане, поэтому связь была удалена."
            )
            continue

        output_names = {output["name"] for output in source_spec.outputs}
        input_names = {field["name"] for field in target_spec.inputs}
        if connection.source_output not in output_names or connection.target_field not in input_names:
            warnings.append(
                f"Удалена некорректная связь {connection.source_id}.{connection.source_output} -> "
                f"{connection.target_id}.{connection.target_field}."
            )
            continue
        canonical_connections.append(connection)

    status = raw_plan.status
    if status == "approval_required" and (not canonical_components or not canonical_connections):
        status = "needs_clarification"
        warnings.append("План получился неполным, поэтому подтверждение на создание flow не запрашивалось.")

    incomplete_components = [
        (
            component.display_name or component.component_name,
            _collect_missing_critical_fields(component, component_specs[component.id]),
        )
        for component in canonical_components
        if component.id in component_specs
    ]
    incomplete_components = [
        (component_name, missing_fields) for component_name, missing_fields in incomplete_components if missing_fields
    ]
    if status == "approval_required" and incomplete_components:
        status = "needs_clarification"
        for component_name, missing_fields in incomplete_components:
            warnings.append(
                f"Компонент '{component_name}' не был полностью настроен. Не хватает полей: "  # noqa: RUF001
                f"{', '.join(missing_fields)}."
            )

    component_names = {component.component_name for component in canonical_components}
    runtime_drivers = _get_runtime_drivers(component_names)

    total_tokens = prompt_tokens + completion_tokens
    tier = _get_cost_tier(total_tokens)

    catalog_summary = FlowPlanCatalogSummary(
        total_stock_components=total_stock_components,
        total_categories=total_categories,
        shortlisted_components=[component.name for component in shortlisted_components],
    )

    return raw_plan.model_copy(
        update={
            "status": status,
            "components": canonical_components,
            "connections": canonical_connections,
            "assumptions": assumptions,
            "warnings": warnings,
            "cost_estimate": FlowPlanCostEstimate(
                tier=tier,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                note=_build_cost_note(
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    runtime_drivers=runtime_drivers,
                ),
            ),
            "catalog_summary": catalog_summary,
        }
    )


async def _execute_planner_graph(
    *,
    input_value: str,
    system_prompt: str,
    global_variables: dict[str, str],
    user_id: str | None,
    provider: str | None,
    model_name: str | None,
    api_key_var: str | None,
) -> dict[str, Any]:
    provider = provider or "OpenAI"
    model_name = model_name or "gpt-4o-mini"

    chat_input = ChatInput()
    chat_input.set(sender="User", sender_name="User", should_store_message=False)

    llm = LanguageModelComponent()
    llm.set_input_value("model", _build_model_config(provider, model_name))

    llm_config: dict[str, Any] = {
        "input_value": chat_input.message_response,
        "system_message": system_prompt,
        "temperature": 0.1,
        "max_tokens": _PLANNER_COMPLETION_BUDGET,
        "stream": False,
    }
    if api_key_var:
        llm_config["api_key"] = api_key_var
    llm.set(**llm_config)

    chat_output = ChatOutput()
    chat_output.set(
        input_value=llm.text_response,
        sender="Machine",
        sender_name="AI",
        should_store_message=False,
        clean_data=True,
        data_template="{text}",
    )

    graph = Graph(start=chat_input, end=chat_output)
    graph.flow_name = "Stock Flow Planner"
    flow_id = normalize_flow_id(global_variables.get("FLOW_ID"))
    if flow_id:
        graph.flow_id = flow_id
    if user_id:
        graph.user_id = user_id
    if "request_variables" not in graph.context:
        graph.context["request_variables"] = {}
    graph.context["request_variables"].update(global_variables)
    graph.prepare()

    inputs = InputValueRequest(input_value=input_value)
    results = [result async for result in graph.async_start(inputs=inputs)]
    return extract_structured_result(results)


async def _add_interactive_clarifications(
    *,
    plan: FlowPlanResult,
    original_request: str,
    translated_request: str,
    global_variables: dict[str, str],
    user_id: str | None,
    provider: str | None,
    model_name: str | None,
    api_key_var: str | None,
) -> FlowPlanResult:
    questions = plan.clarifying_questions[:_MAX_CLARIFICATION_QUESTIONS] or _build_default_clarifying_questions(
        original_request
    )
    prompt = _build_clarification_prompt(
        original_request=original_request,
        translated_request=translated_request,
        plan=plan.model_copy(update={"clarifying_questions": questions}),
    )
    planner_input = json.dumps(
        {
            "original_request": original_request,
            "clarifying_questions": questions,
        },
        ensure_ascii=False,
    )
    clarification_prompt_tokens = _estimate_tokens(prompt) + _estimate_tokens(planner_input)

    try:
        result = await _execute_planner_graph(
            input_value=planner_input,
            system_prompt=prompt,
            global_variables=global_variables,
            user_id=user_id,
            provider=provider,
            model_name=model_name,
            api_key_var=api_key_var,
        )
        response_text = str(result.get("result") or result.get("text") or result)
        clarification_completion_tokens = _estimate_tokens(response_text)
        payload = _InteractiveClarificationPayload.model_validate(_extract_json_payload(response_text))
        clarification_intro = payload.clarification_intro.strip()
        interactive_clarifications = _sanitize_interactive_clarifications(
            payload.interactive_clarifications,
            questions,
        )
    except (ValidationError, ValueError, TypeError) as exc:
        await logger.awarning(f"Clarification planner returned invalid output: {exc}")
        clarification_completion_tokens = 0
        clarification_intro, interactive_clarifications = _build_fallback_interactive_clarifications(questions)

    updated_cost = plan.cost_estimate
    if updated_cost is not None:
        prompt_tokens = updated_cost.prompt_tokens + clarification_prompt_tokens
        completion_tokens = updated_cost.completion_tokens + clarification_completion_tokens
        runtime_drivers = _get_runtime_drivers({component.component_name for component in plan.components})
        updated_cost = FlowPlanCostEstimate(
            tier=_get_cost_tier(prompt_tokens + completion_tokens),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            note=_build_cost_note(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                runtime_drivers=runtime_drivers,
            ),
        )

    return plan.model_copy(
        update={
            "clarifying_questions": questions,
            "clarification_intro": clarification_intro,
            "interactive_clarifications": interactive_clarifications,
            "cost_estimate": updated_cost,
        }
    )


async def plan_stock_flow(
    *,
    original_request: str,
    translated_request: str,
    global_variables: dict[str, str],
    user_id: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    api_key_var: str | None = None,
    clarification_round: int = 0,
) -> FlowPlanResult:
    """Create an approval-ready stock-component flow plan for a business user."""
    catalog, lookup = await _get_stock_catalog()
    shortlisted_components = _shortlist_components(catalog, translated_request)
    system_prompt = _build_planner_prompt(
        original_request=original_request,
        translated_request=translated_request,
        catalog=shortlisted_components,
        clarification_round=clarification_round,
    )
    prompt_tokens = _estimate_tokens(system_prompt) + _estimate_tokens(original_request)

    try:
        result = await _execute_planner_graph(
            input_value=original_request,
            system_prompt=system_prompt,
            global_variables=global_variables,
            user_id=user_id,
            provider=provider,
            model_name=model_name,
            api_key_var=api_key_var,
        )
        response_text = str(result.get("result") or result.get("text") or result)
        completion_tokens = _estimate_tokens(response_text)
        parsed_plan = FlowPlanResult.model_validate(_extract_json_payload(response_text))
    except (ValidationError, ValueError, TypeError) as exc:
        await logger.awarning(f"Flow planner returned invalid output: {exc}")
        completion_tokens = _estimate_tokens("")
        fallback_plan = FlowPlanResult(
            status="needs_clarification",
            title="Нужно уточнение",
            summary="Пока не удалось собрать надёжный план flow только из stock-компонентов.",
            user_summary=original_request,
            approval_message=(
                "После уточнений я предложу минимальную схему и попрошу подтверждение перед созданием flow."
            ),
            data_flow_steps=[],
            components=[],
            connections=[],
            assumptions=[],
            warnings=["Планировщик вернул невалидный ответ, поэтому план был отброшен."],
            clarifying_questions=_build_default_clarifying_questions(original_request),
            cost_estimate=FlowPlanCostEstimate(
                tier="low",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
                note="Планировщик не смог собрать валидный stock-flow. Создание flow не запускалось.",
            ),
            catalog_summary=FlowPlanCatalogSummary(
                total_stock_components=len(catalog),
                total_categories=len({component.category for component in catalog}),
                shortlisted_components=[component.name for component in shortlisted_components],
            ),
        )
        return await _add_interactive_clarifications(
            plan=fallback_plan,
            original_request=original_request,
            translated_request=translated_request,
            global_variables=global_variables,
            user_id=user_id,
            provider=provider,
            model_name=model_name,
            api_key_var=api_key_var,
        )

    canonical_plan = _canonicalize_plan(
        raw_plan=parsed_plan,
        lookup=lookup,
        original_request=original_request,
        translated_request=translated_request,
        provider=provider,
        model_name=model_name,
        total_stock_components=len(catalog),
        total_categories=len({component.category for component in catalog}),
        shortlisted_components=shortlisted_components,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )

    # Enforce clarification round limits regardless of what the LLM decided
    if clarification_round == 0 and canonical_plan.status == "approval_required":
        # First request must always ask questions — LLM ignored the instruction
        default_questions = _build_default_clarifying_questions(original_request)
        canonical_plan = canonical_plan.model_copy(
            update={"status": "needs_clarification", "clarifying_questions": default_questions}
        )

    if clarification_round >= _MAX_CLARIFICATION_ROUNDS and canonical_plan.status == "needs_clarification":
        # Max rounds reached — force approval, stop asking questions
        return canonical_plan.model_copy(update={"status": "approval_required"})

    if canonical_plan.status != "needs_clarification":
        return canonical_plan

    return await _add_interactive_clarifications(
        plan=canonical_plan,
        original_request=original_request,
        translated_request=translated_request,
        global_variables=global_variables,
        user_id=user_id,
        provider=provider,
        model_name=model_name,
        api_key_var=api_key_var,
    )
