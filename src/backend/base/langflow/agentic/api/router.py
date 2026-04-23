"""Langflow Assistant API router.

This module provides the HTTP endpoints for the Langflow Assistant.
All business logic is delegated to service modules.
"""

import base64
import uuid
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from lfx.base.models.unified_models import (
    get_all_variables_for_provider,
    get_model_provider_variable_mapping,
    get_provider_required_variable_keys,
    get_unified_models_detailed,
)
from lfx.log.logger import logger
from sqlalchemy.ext.asyncio import AsyncSession

from langflow.agentic.api.schemas import AssistantRequest
from langflow.agentic.helpers.flow_id import normalize_flow_id
from langflow.agentic.services.assistant_service import (
    execute_flow_with_validation,
    execute_flow_with_validation_streaming,
)
from langflow.agentic.services.flow_executor import execute_flow_file
from langflow.agentic.services.flow_types import (
    LANGFLOW_ASSISTANT_FLOW,
    MAX_VALIDATION_RETRIES,
)
from langflow.agentic.services.provider_service import (
    PREFERRED_PROVIDERS,
    get_default_model,
    get_enabled_providers_for_user,
)
from langflow.api.utils.core import CurrentActiveUser, DbSession

router = APIRouter(prefix="/agentic", tags=["Agentic"], include_in_schema=False)


@dataclass(frozen=True)
class _AssistantContext:
    """Resolved provider, model, and execution context for assistant endpoints."""

    provider: str
    model_name: str
    api_key_name: str
    session_id: str
    global_vars: dict[str, str]
    max_retries: int


async def _resolve_assistant_context(
    request: AssistantRequest,
    user_id: UUID,
    session: AsyncSession,
) -> _AssistantContext:
    """Resolve provider, model, API key, and build execution context.

    Raises:
        HTTPException: If provider is not configured or API key is missing.
    """
    provider_variable_map = get_model_provider_variable_mapping()
    enabled_providers, _ = await get_enabled_providers_for_user(user_id, session)

    if not enabled_providers:
        raise HTTPException(
            status_code=400,
            detail="No model provider is configured. Please configure at least one model provider in Settings.",
        )

    provider = request.provider
    if not provider:
        for preferred in PREFERRED_PROVIDERS:
            if preferred in enabled_providers:
                provider = preferred
                break
        if not provider:
            provider = enabled_providers[0]

    if provider not in enabled_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{provider}' is not configured. Available providers: {enabled_providers}",
        )

    api_key_name = provider_variable_map.get(provider)
    if not api_key_name:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    model_name = request.model_name or get_default_model(provider) or ""

    # Get all configured variables for the provider
    provider_vars = get_all_variables_for_provider(user_id, provider)

    # Validate all required variables are present
    required_keys = get_provider_required_variable_keys(provider)
    missing_keys = [key for key in required_keys if not provider_vars.get(key)]

    if missing_keys:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Missing required configuration for {provider}: {', '.join(missing_keys)}. "
                "Please configure these in Settings > Model Providers."
            ),
        )

    flow_id = normalize_flow_id(request.flow_id)
    if flow_id is None:
        raise HTTPException(status_code=400, detail="A valid flow_id is required for assistant requests.")

    global_vars: dict[str, str] = {
        "USER_ID": str(user_id),
        "FLOW_ID": flow_id,
        "MODEL_NAME": model_name,
        "PROVIDER": provider,
    }

    # Inject all provider variables into the global context
    global_vars.update(provider_vars)

    session_id = request.session_id or str(uuid.uuid4())
    max_retries = request.max_retries if request.max_retries is not None else MAX_VALIDATION_RETRIES

    return _AssistantContext(
        provider=provider,
        model_name=model_name,
        api_key_name=api_key_name,
        session_id=session_id,
        global_vars=global_vars,
        max_retries=max_retries,
    )


@router.post("/execute/{flow_name}")
async def execute_named_flow(flow_name: str, request: AssistantRequest, current_user: CurrentActiveUser) -> dict:
    """Execute a named flow from the flows directory."""
    user_id = current_user.id
    flow_id = normalize_flow_id(request.flow_id)
    if flow_id is None:
        raise HTTPException(status_code=400, detail="A valid flow_id is required for assistant requests.")

    global_vars = {
        "USER_ID": str(user_id),
        "FLOW_ID": flow_id,
    }

    if request.component_id:
        global_vars["COMPONENT_ID"] = request.component_id
    if request.field_name:
        global_vars["FIELD_NAME"] = request.field_name

    try:
        # Check for OpenAI variables (required for some assistant features)
        openai_vars = get_all_variables_for_provider(user_id, "OpenAI")
        global_vars.update(openai_vars)
    except (ValueError, HTTPException):
        logger.debug("OpenAI variables not configured, continuing without them")

    flow_filename = f"{flow_name}.json"
    # Generate unique session_id per request to isolate memory
    session_id = str(uuid.uuid4())

    return await execute_flow_file(
        flow_filename=flow_filename,
        input_value=request.input_value,
        global_variables=global_vars,
        verbose=True,
        session_id=session_id,
    )


@router.get("/check-config")
async def check_assistant_config(
    current_user: CurrentActiveUser,
    session: DbSession,
) -> dict:
    """Check if the Langflow Assistant is properly configured.

    Returns available providers with their configured status and available models.
    """
    user_id = current_user.id
    enabled_providers, _ = await get_enabled_providers_for_user(user_id, session)

    all_providers = []

    if enabled_providers:
        models_by_provider = get_unified_models_detailed(
            providers=enabled_providers,
            include_unsupported=False,
            include_deprecated=False,
            model_type="language",
        )

        for provider_dict in models_by_provider:
            provider_name = provider_dict.get("provider")
            models = provider_dict.get("models", [])

            model_list = []
            for model in models:
                model_name = model.get("model_name")
                display_name = model.get("display_name", model_name)
                metadata = model.get("metadata", {})

                is_deprecated = metadata.get("deprecated", False)
                is_not_supported = metadata.get("not_supported", False)

                if not is_deprecated and not is_not_supported:
                    model_list.append(
                        {
                            "name": model_name,
                            "display_name": display_name,
                        }
                    )

            default_model = get_default_model(provider_name)
            if not default_model and model_list:
                default_model = model_list[0]["name"]

            if model_list:
                all_providers.append(
                    {
                        "name": provider_name,
                        "configured": True,
                        "default_model": default_model,
                        "models": model_list,
                    }
                )

    default_provider = None
    default_model = None

    providers_with_models = [p["name"] for p in all_providers]

    for preferred in PREFERRED_PROVIDERS:
        if preferred in providers_with_models:
            default_provider = preferred
            for p in all_providers:
                if p["name"] == preferred:
                    default_model = p["default_model"]
                    break
            break

    if not default_provider and all_providers:
        default_provider = all_providers[0]["name"]
        default_model = all_providers[0]["default_model"]

    return {
        "configured": len(enabled_providers) > 0,
        "configured_providers": enabled_providers,
        "providers": all_providers,
        "default_provider": default_provider,
        "default_model": default_model,
    }


@router.post("/assist")
async def assist(
    request: AssistantRequest,
    current_user: CurrentActiveUser,
    session: DbSession,
) -> dict:
    """Chat with the Langflow Assistant."""
    ctx = await _resolve_assistant_context(request, current_user.id, session)

    logger.info(f"Executing {LANGFLOW_ASSISTANT_FLOW} with {ctx.provider}/{ctx.model_name}")

    return await execute_flow_with_validation(
        flow_filename=LANGFLOW_ASSISTANT_FLOW,
        input_value=request.input_value or "",
        global_variables=ctx.global_vars,
        max_retries=ctx.max_retries,
        user_id=str(current_user.id),
        session_id=ctx.session_id,
        provider=ctx.provider,
        model_name=ctx.model_name,
        api_key_var=ctx.api_key_name,
    )


@router.post("/assist/stream")
async def assist_stream(
    request: AssistantRequest,
    http_request: Request,
    current_user: CurrentActiveUser,
    session: DbSession,
) -> StreamingResponse:
    """Chat with the Langflow Assistant with streaming progress updates."""
    ctx = await _resolve_assistant_context(request, current_user.id, session)

    return StreamingResponse(
        execute_flow_with_validation_streaming(
            flow_filename=LANGFLOW_ASSISTANT_FLOW,
            input_value=request.input_value or "",
            global_variables=ctx.global_vars,
            max_retries=ctx.max_retries,
            user_id=str(current_user.id),
            session_id=ctx.session_id,
            provider=ctx.provider,
            model_name=ctx.model_name,
            api_key_var=ctx.api_key_name,
            is_disconnected=http_request.is_disconnected,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


_TRANSCRIBE_MODEL = "google/gemini-3.1-flash-lite-preview"
_OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
_TRANSCRIBE_PROMPT = (
    "Transcribe the audio exactly as spoken. "
    "Return only the transcribed text with no explanations, labels, or formatting."
)


@router.post("/transcribe")
async def transcribe_audio(
    current_user: CurrentActiveUser,
    audio: Annotated[UploadFile, File()],
) -> dict:
    """Transcribe an audio clip using Gemini via OpenRouter.

    Returns {"transcript": "<text>"}.
    """
    provider_vars = get_all_variables_for_provider(current_user.id, "OpenRouter")
    api_key = provider_vars.get("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="OpenRouter API key is not configured. Please add it in Settings > Model Providers.",
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    audio_b64 = base64.b64encode(audio_bytes).decode()
    mime = audio.content_type or "audio/webm"

    payload = {
        "model": _TRANSCRIBE_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _TRANSCRIBE_PROMPT},
                    {
                        "type": "input_audio",
                        "input_audio": {"data": audio_b64, "format": mime.split("/")[-1]},
                    },
                ],
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _OPENROUTER_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        resp.raise_for_status()
        data = resp.json()
        transcript = data["choices"][0]["message"]["content"] or ""
    except httpx.HTTPStatusError as exc:
        logger.error(f"OpenRouter transcription error: {exc.response.text}")
        raise HTTPException(status_code=502, detail="Transcription service returned an error.") from exc
    except Exception as exc:
        logger.error(f"Transcription failed: {exc}")
        raise HTTPException(status_code=502, detail="Transcription failed.") from exc

    return {"transcript": transcript.strip()}
