import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.gateway.authz import (
    _AuthorizationUnavailable,
    _is_internal_caller,
    resolve_model_authorization,
)
from app.gateway.deps import get_config, get_optional_user_from_request, require_admin_user
from deerflow.authz.provider import AuthzDecision, AuthzRequest
from deerflow.config.app_config import AppConfig
from deerflow.config.models_config import (
    MASKED_API_KEY,
    PROVIDER_ALLOWLIST,
    ModelsConfig,
    atomic_write_models_config,
    endpoint_key_for,
    models_config_write_lock,
    preserve_api_key,
    resolve_provider_use,
    reverse_lookup_provider,
)
from deerflow.config.runtime_paths import project_root

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["models"])


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    context_window: int | None = Field(
        default=None,
        description="Total context window size in tokens (prompt + completion); None when unconfigured",
    )


class TokenUsageResponse(BaseModel):
    """Token usage display configuration."""

    enabled: bool = Field(default=False, description="Whether token usage display is enabled")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]
    token_usage: TokenUsageResponse


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models(
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelsListResponse:
    """List all available models from configuration.

    Returns model information suitable for frontend display,
    excluding sensitive fields like API keys and internal configuration.

    When ``authorization.enabled`` is true, only models the caller's role may
    ``list`` are returned (filtered via ``provider.filter_resources``). A
    provider error yields an empty list (fail-closed) or all models (fail-open).

    Returns:
        A list of all configured models with their metadata and token usage display settings.

    Example Response:
        ```json
        {
            "models": [
                {
                    "name": "gpt-4",
                    "model": "gpt-4",
                    "display_name": "GPT-4",
                    "description": "OpenAI GPT-4 model",
                    "supports_thinking": false,
                    "supports_reasoning_effort": false
                },
                {
                    "name": "claude-3-opus",
                    "model": "claude-3-opus",
                    "display_name": "Claude 3 Opus",
                    "description": "Anthropic Claude 3 Opus model",
                    "supports_thinking": true,
                    "supports_reasoning_effort": false
                }
            ],
            "token_usage": {
                "enabled": true
            }
        }
        ```
    """
    visible_models = config.models
    fail_closed = config.authorization.fail_closed

    user = await get_optional_user_from_request(request)
    if user is not None:
        try:
            provider, principal = resolve_model_authorization(user, is_internal=_is_internal_caller(request, user))
        except _AuthorizationUnavailable as exc:
            if exc.fail_closed:
                visible_models = []
        else:
            if provider is not None and principal is not None:
                try:
                    allowed_names = provider.filter_resources(principal, "model", [m.name for m in config.models])
                    if not isinstance(allowed_names, list) or any(not isinstance(n, str) for n in allowed_names):
                        raise TypeError("AuthorizationProvider.filter_resources must return list[str]")
                    allowed_set = set(allowed_names)
                    visible_models = [m for m in config.models if m.name in allowed_set]
                except Exception:
                    logger.warning("Authorization provider failed while filtering models", exc_info=True)
                    visible_models = [] if fail_closed else config.models

    models = [
        ModelResponse(
            name=model.name,
            model=model.model,
            display_name=model.display_name,
            description=model.description,
            supports_thinking=model.supports_thinking,
            supports_reasoning_effort=model.supports_reasoning_effort,
            context_window=model.context_window,
        )
        for model in visible_models
    ]
    return ModelsListResponse(
        models=models,
        token_usage=TokenUsageResponse(enabled=config.token_usage.enabled),
    )


# ── Admin models management (web "Models" settings, spec 2026-09-10 §5.3–§5.5) ──
# NOTE: these routes are declared BEFORE ``/models/{model_name}`` below: FastAPI
# matches in registration order and the ``{model_name}`` path param would
# otherwise shadow ``/models/config`` (model_name="config" → 404).

_ADMIN_DETAIL = "Admin privileges required to manage model configuration."


class ManagedModelInput(BaseModel):
    """One UI-managed model submitted by the settings UI.

    ``extra="forbid"`` is the security boundary: a free-text ``use:`` class path
    (a dynamic-import / code-execution vector) is rejected outright; the caller
    supplies a curated ``provider`` id that the server maps to a fixed class
    path (spec §5.3).
    """

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(..., description="Curated provider id from the allowlist (openai-compatible / anthropic / deepseek).")
    name: str = Field(..., description="Unique model name (defaults to the provider model id in the UI).")
    model: str = Field(..., description="Provider-side model identifier.")
    api_key: str | None = Field(default=None, description="API key; the masking sentinel means 'keep the stored key'.")
    endpoint: str | None = Field(default=None, description="Endpoint override; stored under the provider's canonical key (base_url or api_base).")
    display_name: str | None = Field(default=None, description="Human-readable name.")
    description: str | None = Field(default=None, description="Model description.")
    supports_thinking: bool = Field(default=False, description="Whether the model supports thinking mode.")
    supports_vision: bool = Field(default=False, description="Whether the model supports vision inputs.")
    supports_reasoning_effort: bool = Field(default=False, description="Whether the model supports reasoning effort.")
    context_window: int | None = Field(default=None, gt=0, description="Total context window in tokens (prompt + completion).")
    max_tokens: int | None = Field(default=None, gt=0, description="Per-call output cap.")
    use_responses_api: bool | None = Field(default=None, description="Route OpenAI-compatible calls through /v1/responses.")


class ModelsConfigUpdateRequest(BaseModel):
    """Whole-collection replacement of the UI-managed model set."""

    model_config = ConfigDict(extra="forbid")

    models: list[ManagedModelInput] = Field(default_factory=list)


class ManagedModelResponse(BaseModel):
    """Admin view of one model: masked key, provider, source, editability."""

    name: str
    model: str
    display_name: str | None = None
    description: str | None = None
    provider: str | None = Field(default=None, description="Allowlisted provider id; None when the stored use: is not allowlisted.")
    endpoint_key: str | None = Field(default=None, description="Canonical endpoint field name (base_url / api_base).")
    endpoint: str | None = Field(default=None, description="Current endpoint override value.")
    api_key: str = Field(default=MASKED_API_KEY, description="Always the masking sentinel; never the real key.")
    supports_thinking: bool = False
    supports_vision: bool = False
    supports_reasoning_effort: bool = False
    context_window: int | None = None
    source: str = Field(default="config_file", description="Origin: 'ui' (models_config.json) or 'config_file' (config.yaml).")
    editable: bool = Field(default=False, description="True only for UI-managed models.")


class ModelsConfigResponse(BaseModel):
    models: list[ManagedModelResponse]


def _managed_response(
    *,
    name: str,
    model: str,
    display_name: str | None,
    description: str | None,
    provider: str | None,
    endpoint_key: str | None,
    endpoint: str | None,
    supports_thinking: bool,
    supports_vision: bool,
    supports_reasoning_effort: bool,
    context_window: int | None,
    source: str,
) -> ManagedModelResponse:
    return ManagedModelResponse(
        name=name,
        model=model,
        display_name=display_name,
        description=description,
        provider=provider,
        endpoint_key=endpoint_key,
        endpoint=endpoint,
        api_key=MASKED_API_KEY,
        supports_thinking=supports_thinking,
        supports_vision=supports_vision,
        supports_reasoning_effort=supports_reasoning_effort,
        context_window=context_window,
        source=source,
        editable=(source == "ui"),
    )


@router.get(
    "/models/config",
    response_model=ModelsConfigResponse,
    summary="List Managed Models (admin)",
    description="Admin view of all models with masked API keys, provider, source and editability.",
)
async def get_models_config(
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelsConfigResponse:
    """Return the merged model set for the settings UI (spec §5.5).

    config.yaml-sourced models are read-only (``source=config_file``);
    models_config.json-sourced models are editable (``source=ui``).
    """
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    responses = []
    for model in config.models:
        dumped = model.model_dump()
        provider = reverse_lookup_provider(model.use)
        endpoint_key = endpoint_key_for(provider) if provider else None
        endpoint = dumped.get(endpoint_key) if endpoint_key else None
        source = "ui" if config.is_ui_managed_model(model.name) else "config_file"
        responses.append(
            _managed_response(
                name=model.name,
                model=model.model,
                display_name=model.display_name,
                description=model.description,
                provider=provider,
                endpoint_key=endpoint_key,
                endpoint=endpoint,
                supports_thinking=model.supports_thinking,
                supports_vision=model.supports_vision,
                supports_reasoning_effort=model.supports_reasoning_effort,
                context_window=model.context_window,
                source=source,
            )
        )
    return ModelsConfigResponse(models=responses)


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(
    model_name: str,
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found; 403 if the caller's role may not
        ``use`` the model (only when ``authorization.enabled`` is true). A
        provider resolution error yields 403 (fail-closed) or allows the request
        (fail-open), mirroring ``list_models``'s provider-error semantics.

    Example Response:
        ```json
        {
            "name": "gpt-4",
            "display_name": "GPT-4",
            "description": "OpenAI GPT-4 model",
            "supports_thinking": false
        }
        ```
    """
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    # Phase 3: enforce model:use authorization (deny → 403, not 404, since the
    # model exists but the role lacks permission to use it).
    fail_closed = config.authorization.fail_closed
    user = await get_optional_user_from_request(request)
    if user is not None:
        try:
            provider, principal = resolve_model_authorization(user, is_internal=_is_internal_caller(request, user))
        except _AuthorizationUnavailable:
            if fail_closed:
                raise HTTPException(status_code=403, detail=f"Model '{model_name}' is not available for your role")
        else:
            if provider is not None and principal is not None:
                try:
                    decision = provider.authorize(AuthzRequest(principal=principal, resource="model", action="use", target=model_name))
                    if not isinstance(decision, AuthzDecision):
                        raise TypeError("AuthorizationProvider.authorize must return AuthzDecision")
                    allowed = decision.allow
                except Exception:
                    logger.warning(
                        "Authorization provider failed while checking model:use for %s",
                        model_name,
                        exc_info=True,
                    )
                    allowed = not fail_closed
                if not allowed:
                    raise HTTPException(status_code=403, detail=f"Model '{model_name}' is not available for your role")

    return ModelResponse(
        name=model.name,
        model=model.model,
        display_name=model.display_name,
        description=model.description,
        supports_thinking=model.supports_thinking,
        supports_reasoning_effort=model.supports_reasoning_effort,
        context_window=model.context_window,
    )


@router.put(
    "/models/config",
    response_model=ModelsConfigResponse,
    summary="Replace Managed Models (admin)",
    description="Replace the UI-managed model set in models_config.json. config.yaml is never written.",
)
async def put_models_config(
    request: Request,
    body: ModelsConfigUpdateRequest,
    config: AppConfig = Depends(get_config),
) -> ModelsConfigResponse:
    """Validate and persist the whole UI-managed model collection (spec §5.3–§5.5).

    Each entry's ``provider`` is mapped to a fixed ``use:`` class path and the
    provider's canonical endpoint key; a masking-sentinel ``api_key`` preserves
    the stored key. Writes are atomic and lock-serialized; the config hot-reload
    signature picks the change up on the next read.
    """
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    stored = ModelsConfig.from_file()
    stored_keys: dict[str, str] = {}
    for existing in stored.models:
        stored_keys[existing.name] = str(existing.model_dump().get("api_key") or "")

    seen: set[str] = set()
    entries: list[dict] = []
    responses: list[ManagedModelResponse] = []
    for item in body.models:
        if item.name in seen:
            raise HTTPException(status_code=422, detail=f"Duplicate model name '{item.name}' in request.")
        seen.add(item.name)
        if not item.name.strip():
            raise HTTPException(status_code=422, detail="Model name must be non-empty.")
        if not item.model.strip():
            raise HTTPException(status_code=422, detail=f"Model '{item.name}' must specify a provider model id.")
        use = resolve_provider_use(item.provider)
        if use is None:
            allowed = ", ".join(sorted(PROVIDER_ALLOWLIST))
            raise HTTPException(status_code=422, detail=f"Unknown provider '{item.provider}'. Allowed providers: {allowed}.")
        endpoint_key = endpoint_key_for(item.provider) or "base_url"
        api_key = preserve_api_key(item.api_key, stored_keys.get(item.name, "")) if item.api_key is not None else stored_keys.get(item.name, "")

        entry: dict = {
            "name": item.name,
            "use": use,
            "model": item.model,
            "display_name": item.display_name,
            "description": item.description,
            "api_key": api_key,
            "supports_thinking": item.supports_thinking,
            "supports_vision": item.supports_vision,
            "supports_reasoning_effort": item.supports_reasoning_effort,
            "context_window": item.context_window,
            "max_tokens": item.max_tokens,
            "use_responses_api": item.use_responses_api,
        }
        if item.endpoint:
            entry[endpoint_key] = item.endpoint
        entries.append({key: value for key, value in entry.items() if value is not None})

        responses.append(
            _managed_response(
                name=item.name,
                model=item.model,
                display_name=item.display_name,
                description=item.description,
                provider=item.provider,
                endpoint_key=endpoint_key,
                endpoint=item.endpoint,
                supports_thinking=item.supports_thinking,
                supports_vision=item.supports_vision,
                supports_reasoning_effort=item.supports_reasoning_effort,
                context_window=item.context_window,
                source="ui",
            )
        )

    target_path = ModelsConfig.resolve_config_path() or (project_root() / "models_config.json")

    def _write() -> None:
        with models_config_write_lock:
            atomic_write_models_config(target_path, {"models": entries})

    await asyncio.to_thread(_write)
    return ModelsConfigResponse(models=responses)
