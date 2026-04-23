from .model_metadata import create_model_metadata

# Yandex AI Studio (Foundation Models) via OpenAI-compatible API.
# Model names are simple identifiers; full URI (gpt://<folder_id>/<model>/latest)
# is constructed at instantiation time using the YANDEX_FOLDER_ID setting.
# Docs: https://cloud.yandex.com/en/docs/foundation-models/concepts/api-openai
YANDEX_MODELS_DETAILED = [
    create_model_metadata(
        provider="Yandex AI Studio",
        name="yandexgpt",
        icon="YandexAIStudio",
        tool_calling=True,
    ),
    create_model_metadata(
        provider="Yandex AI Studio",
        name="yandexgpt-lite",
        icon="YandexAIStudio",
        tool_calling=True,
    ),
    create_model_metadata(
        provider="Yandex AI Studio",
        name="yandexgpt-32k",
        icon="YandexAIStudio",
    ),
    create_model_metadata(
        provider="Yandex AI Studio",
        name="qwen3.5-35b-a3b-fp8",
        icon="YandexAIStudio",
        tool_calling=True,
    ),
    create_model_metadata(
        provider="Yandex AI Studio",
        name="llama-lite",
        icon="YandexAIStudio",
    ),
    create_model_metadata(
        provider="Yandex AI Studio",
        name="llama",
        icon="YandexAIStudio",
    ),
]
