from .model_metadata import create_model_metadata

# Static fallback list of popular OpenRouter models.
# Used when the API is unavailable or for initial display.
# OpenRouter hosts hundreds of models; this curated list covers the most common ones.
OPENROUTER_MODELS_DETAILED = [
    # OpenAI via OpenRouter
    create_model_metadata(provider="OpenRouter", name="openai/gpt-4o", icon="OpenRouter", tool_calling=True),
    create_model_metadata(provider="OpenRouter", name="openai/gpt-4o-mini", icon="OpenRouter", tool_calling=True),
    create_model_metadata(
        provider="OpenRouter", name="openai/o1", icon="OpenRouter", tool_calling=True, reasoning=True
    ),
    create_model_metadata(
        provider="OpenRouter", name="openai/o3-mini", icon="OpenRouter", tool_calling=True, reasoning=True
    ),
    # Anthropic via OpenRouter
    create_model_metadata(provider="OpenRouter", name="anthropic/claude-opus-4", icon="OpenRouter", tool_calling=True),
    create_model_metadata(
        provider="OpenRouter", name="anthropic/claude-sonnet-4", icon="OpenRouter", tool_calling=True
    ),
    create_model_metadata(
        provider="OpenRouter", name="anthropic/claude-3-5-haiku", icon="OpenRouter", tool_calling=True
    ),
    # Google via OpenRouter
    create_model_metadata(
        provider="OpenRouter", name="google/gemini-2.0-flash-001", icon="OpenRouter", tool_calling=True
    ),
    create_model_metadata(
        provider="OpenRouter", name="google/gemini-2.5-pro-preview-05-06", icon="OpenRouter", tool_calling=True
    ),
    # Meta via OpenRouter
    create_model_metadata(
        provider="OpenRouter",
        name="meta-llama/llama-3.3-70b-instruct",
        icon="OpenRouter",
        tool_calling=True,
    ),
    create_model_metadata(
        provider="OpenRouter",
        name="meta-llama/llama-4-maverick",
        icon="OpenRouter",
        tool_calling=True,
    ),
    # Mistral via OpenRouter
    create_model_metadata(
        provider="OpenRouter",
        name="mistralai/mistral-small-3.2-24b-instruct",
        icon="OpenRouter",
        tool_calling=True,
    ),
    create_model_metadata(
        provider="OpenRouter", name="mistralai/mixtral-8x7b-instruct", icon="OpenRouter", tool_calling=True
    ),
    # Qwen via OpenRouter
    create_model_metadata(provider="OpenRouter", name="qwen/qwen3.6-plus", icon="OpenRouter", tool_calling=True),
    create_model_metadata(provider="OpenRouter", name="qwen/qwen3-235b-a22b", icon="OpenRouter", tool_calling=True),
    create_model_metadata(provider="OpenRouter", name="qwen/qwen3-30b-a3b", icon="OpenRouter", tool_calling=True),
    # DeepSeek via OpenRouter
    create_model_metadata(provider="OpenRouter", name="deepseek/deepseek-r1", icon="OpenRouter", reasoning=True),
    create_model_metadata(
        provider="OpenRouter", name="deepseek/deepseek-chat-v3-0324", icon="OpenRouter", tool_calling=True
    ),
]
