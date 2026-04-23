from langflow.agentic.api.schemas import (
    FlowPlanComponent,
    FlowPlanConnection,
    FlowPlanResult,
)
from langflow.agentic.services.flow_planner import (
    _build_clarification_prompt,
    _build_fallback_interactive_clarifications,
    _build_planner_prompt,
    _canonicalize_plan,
    _CatalogComponent,
    _simplify_input_fields,
)


def _make_catalog_component(
    *,
    name: str,
    display_name: str,
    category: str,
    inputs: list[dict],
    outputs: list[dict],
) -> _CatalogComponent:
    return _CatalogComponent(
        name=name,
        display_name=display_name,
        category=category,
        description=f"{display_name} description",
        inputs=inputs,
        outputs=outputs,
        aliases={name.lower(), display_name.lower()},
        searchable_text=f"{name} {display_name}".lower(),
    )


def test_simplify_input_fields_should_keep_llm_instruction_fields():
    template = {
        "_type": "Component",
        "api_key": {"type": "str", "required": False, "show": True},
        "base_url_ibm_watsonx": {"type": "str", "required": False, "show": False},
        "input_value": {
            "type": "str",
            "required": False,
            "show": True,
            "input_types": ["Message"],
        },
        "max_tokens": {"type": "int", "required": False, "show": True, "value": 0},
        "model": {
            "type": "model",
            "required": True,
            "show": True,
            "input_types": ["LanguageModel"],
        },
        "ollama_base_url": {"type": "str", "required": False, "show": False},
        "project_id": {"type": "str", "required": False, "show": False},
        "stream": {"type": "bool", "required": False, "show": True, "value": False},
        "system_message": {
            "type": "str",
            "required": False,
            "show": True,
            "multiline": True,
        },
        "temperature": {
            "type": "slider",
            "required": False,
            "show": True,
            "value": 0.1,
        },
        "unused_hidden_field": {"type": "str", "required": False, "show": False},
    }

    fields = _simplify_input_fields(template)
    field_names = [field["name"] for field in fields]

    assert "model" in field_names
    assert "input_value" in field_names
    assert "system_message" in field_names


def test_build_planner_prompt_should_require_instruction_fields():
    catalog_component = _make_catalog_component(
        name="LanguageModelComponent",
        display_name="Language Model",
        category="models",
        inputs=[
            {
                "name": "model",
                "type": "model",
                "required": True,
                "show": True,
                "advanced": False,
                "multiline": False,
                "default": None,
                "input_types": ["LanguageModel"],
            },
            {
                "name": "system_message",
                "type": "str",
                "required": False,
                "show": True,
                "advanced": False,
                "multiline": True,
                "default": None,
                "input_types": ["Message"],
            },
        ],
        outputs=[{"name": "text_output", "types": ["Message"]}],
    )

    prompt = _build_planner_prompt(
        original_request="Создай flow для ответов на вопросы по документации.",
        translated_request="Build a flow that answers documentation questions.",
        catalog=[catalog_component],
    )

    assert "`system_message`" in prompt
    assert "Never leave an active LLM or prompt component" in prompt


def test_build_clarification_prompt_should_require_two_options_and_russian():
    plan = FlowPlanResult(
        status="needs_clarification",
        title="Нужно уточнение",
        summary="Нужно уточнить источник данных.",
        user_summary="Собери flow для отчётов.",
        approval_message="После уточнений я предложу flow.",
        data_flow_steps=[],
        components=[],
        connections=[],
        assumptions=[],
        warnings=[],
        clarifying_questions=["Откуда брать данные?", "В каком формате нужен результат?"],  # noqa: RUF001
    )

    prompt = _build_clarification_prompt(
        original_request=plan.user_summary,
        translated_request="Build a flow for reports.",
        plan=plan,
    )

    assert "strictly in Russian" in prompt
    assert "produce exactly 2 concise suggested options" in prompt
    assert "input_placeholder" in prompt


def test_build_fallback_interactive_clarifications_should_offer_two_options_per_question():
    intro, clarifications = _build_fallback_interactive_clarifications(
        [
            "Откуда именно нужно собирать данные?",
            "В каком формате вы хотите получить итоговый результат?",  # noqa: RUF001
            "Есть ли у вас уже готовые данные для теста?",  # noqa: RUF001
        ]
    )

    assert "ответьте на несколько коротких вопросов" in intro
    assert len(clarifications) == 3
    assert all(len(clarification.options) == 2 for clarification in clarifications)
    assert clarifications[0].options[0].label == "Публичные URL"
    assert clarifications[1].options[1].label == "JSON"
    assert clarifications[2].options[0].label == "Есть готовые данные"


def test_canonicalize_plan_should_autofill_language_model_fields():
    lookup = {
        "chatinput": _make_catalog_component(
            name="ChatInput",
            display_name="Chat Input",
            category="input_output",
            inputs=[
                {
                    "name": "input_value",
                    "type": "str",
                    "required": False,
                    "show": True,
                    "advanced": False,
                    "multiline": True,
                    "default": None,
                    "input_types": [],
                }
            ],
            outputs=[{"name": "message", "types": ["Message"]}],
        ),
        "languagemodelcomponent": _make_catalog_component(
            name="LanguageModelComponent",
            display_name="Language Model",
            category="models",
            inputs=[
                {
                    "name": "model",
                    "type": "model",
                    "required": True,
                    "show": True,
                    "advanced": False,
                    "multiline": False,
                    "default": None,
                    "input_types": ["LanguageModel"],
                },
                {
                    "name": "input_value",
                    "type": "str",
                    "required": False,
                    "show": True,
                    "advanced": False,
                    "multiline": False,
                    "default": None,
                    "input_types": ["Message"],
                },
                {
                    "name": "system_message",
                    "type": "str",
                    "required": False,
                    "show": True,
                    "advanced": False,
                    "multiline": True,
                    "default": None,
                    "input_types": ["Message"],
                },
            ],
            outputs=[{"name": "text_output", "types": ["Message"]}],
        ),
        "chatoutput": _make_catalog_component(
            name="ChatOutput",
            display_name="Chat Output",
            category="input_output",
            inputs=[
                {
                    "name": "input_value",
                    "type": "other",
                    "required": True,
                    "show": True,
                    "advanced": False,
                    "multiline": False,
                    "default": None,
                    "input_types": ["Message"],
                }
            ],
            outputs=[{"name": "message", "types": ["Message"]}],
        ),
    }
    raw_plan = FlowPlanResult(
        status="approval_required",
        title="Диалоговый помощник",
        summary="Отвечает на вопрос и называет тему диалога.",
        user_summary="Создай мне flow, который отвечает на вопрос пользователя и называет тему диалога.",
        approval_message="Подтвердите создание flow.",
        data_flow_steps=["Вопрос пользователя идет в LLM и возвращается в чат."],
        components=[
            FlowPlanComponent(
                id="chat_input",
                component_name="ChatInput",
                purpose="Принимает вопрос пользователя.",
                field_values={},
            ),
            FlowPlanComponent(
                id="llm",
                component_name="LanguageModelComponent",
                purpose="Отвечает на вопрос пользователя и называет тему диалога.",
                field_values={},
            ),
            FlowPlanComponent(
                id="chat_output",
                component_name="ChatOutput",
                purpose="Показывает ответ пользователю.",
                field_values={},
            ),
        ],
        connections=[
            FlowPlanConnection(
                source_id="chat_input",
                source_output="message",
                target_id="llm",
                target_field="input_value",
            ),
            FlowPlanConnection(
                source_id="llm",
                source_output="text_output",
                target_id="chat_output",
                target_field="input_value",
            ),
        ],
        assumptions=[],
        warnings=[],
        clarifying_questions=[],
    )

    plan = _canonicalize_plan(
        raw_plan=raw_plan,
        lookup=lookup,
        original_request=raw_plan.user_summary,
        translated_request="Create a flow that answers the user and names the dialogue topic.",
        provider="openai",
        model_name="gpt-4o-mini",
        total_stock_components=3,
        total_categories=2,
        shortlisted_components=list(lookup.values()),
        prompt_tokens=1200,
        completion_tokens=500,
    )

    llm_component = next(
        component for component in plan.components if component.component_name == "LanguageModelComponent"
    )

    assert plan.status == "approval_required"
    assert llm_component.field_values["model"][0]["name"] == "gpt-4o-mini"
    assert "system_message" in llm_component.field_values
    assert "тему диалога" in llm_component.field_values["system_message"]
