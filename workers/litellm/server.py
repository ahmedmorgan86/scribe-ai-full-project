"""
LiteLLM Gateway Server

FastAPI wrapper for LiteLLM providing multi-provider LLM access with fallback support.
"""

import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import litellm
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.health import HealthChecker, HealthCheckResponse, DependencyStatus

load_dotenv()

litellm.set_verbose = os.getenv("LITELLM_VERBOSE", "false").lower() == "true"

SERVICE_VERSION = "1.0.0"
health_checker: HealthChecker | None = None


class CompletionRequest(BaseModel):
    """Request model for chat completion."""

    model: str
    messages: list[dict]
    max_tokens: Optional[int] = 4096
    temperature: Optional[float] = 0.7
    stop: Optional[list[str]] = None


class CompletionResponse(BaseModel):
    """Response model for chat completion."""

    content: str
    model: str
    usage: dict
    stop_reason: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global health_checker
    print("LiteLLM Gateway starting...")
    health_checker = HealthChecker(service_name="litellm-gateway", version=SERVICE_VERSION)
    yield
    print("LiteLLM Gateway shutting down...")


app = FastAPI(
    title="LiteLLM Gateway",
    description="Multi-provider LLM gateway with fallback support",
    version="1.0.0",
    lifespan=lifespan,
)


def check_provider_key(provider: str) -> bool:
    """Check if API key exists for a provider."""
    key_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
    }
    env_var = key_map.get(provider)
    return bool(os.getenv(env_var)) if env_var else False


async def check_provider_connectivity(provider: str) -> DependencyStatus:
    """Check if a provider API is reachable with a minimal request."""
    start = datetime.utcnow()
    key_configured = check_provider_key(provider)

    if not key_configured:
        return DependencyStatus(
            name=f"{provider}-api",
            status="unavailable",
            latency_ms=0,
            details={"error": "API key not configured"},
        )

    try:
        response = await litellm.acompletion(
            model="gpt-4o-mini" if provider == "openai" else "claude-3-haiku-20240307",
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=1,
        )
        latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        return DependencyStatus(
            name=f"{provider}-api",
            status="healthy",
            latency_ms=latency_ms,
            details={"model": response.model},
        )
    except Exception as e:
        latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        return DependencyStatus(
            name=f"{provider}-api",
            status="degraded",
            latency_ms=latency_ms,
            details={"error": str(e), "key_configured": True},
        )


@app.get("/health", response_model=HealthCheckResponse)
async def health_check(deep: bool = False) -> HealthCheckResponse:
    """
    Check gateway health and provider availability.

    Args:
        deep: If True, performs actual API connectivity checks (slower but thorough).
              If False, only checks if API keys are configured.
    """
    if not health_checker:
        return HealthCheckResponse(
            service="litellm-gateway",
            status="unavailable",
            version=SERVICE_VERSION,
            timestamp=datetime.utcnow().isoformat(),
            uptime_seconds=0,
            dependencies=[],
            checks={},
        )

    checks = {
        "anthropic_key_configured": check_provider_key("anthropic"),
        "openai_key_configured": check_provider_key("openai"),
    }

    dependencies: list[DependencyStatus] = []

    if deep:
        if checks["anthropic_key_configured"]:
            dependencies.append(await check_provider_connectivity("anthropic"))
        if checks["openai_key_configured"]:
            dependencies.append(await check_provider_connectivity("openai"))
    else:
        if checks["anthropic_key_configured"]:
            dependencies.append(
                DependencyStatus(
                    name="anthropic-api",
                    status="healthy",
                    details={"key_configured": True, "note": "Use ?deep=true for connectivity check"},
                )
            )
        if checks["openai_key_configured"]:
            dependencies.append(
                DependencyStatus(
                    name="openai-api",
                    status="healthy",
                    details={"key_configured": True, "note": "Use ?deep=true for connectivity check"},
                )
            )

    has_any_provider = checks["anthropic_key_configured"] or checks["openai_key_configured"]
    checks["has_llm_provider"] = has_any_provider

    return health_checker.build_response(dependencies, checks)


@app.post("/completion", response_model=CompletionResponse)
async def create_completion(request: CompletionRequest):
    """
    Create a chat completion using the specified model.

    LiteLLM handles model routing automatically based on the model prefix:
    - claude-* -> Anthropic
    - gpt-* -> OpenAI
    """
    try:
        response = await litellm.acompletion(
            model=request.model,
            messages=request.messages,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            stop=request.stop,
        )

        content = response.choices[0].message.content or ""
        stop_reason = response.choices[0].finish_reason

        usage = {
            "input_tokens": response.usage.prompt_tokens if response.usage else 0,
            "output_tokens": response.usage.completion_tokens if response.usage else 0,
            "total_tokens": response.usage.total_tokens if response.usage else 0,
        }

        return CompletionResponse(
            content=content,
            model=response.model or request.model,
            usage=usage,
            stop_reason=stop_reason,
        )

    except litellm.exceptions.AuthenticationError as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")
    except litellm.exceptions.RateLimitError as e:
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded: {str(e)}")
    except litellm.exceptions.APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"API connection error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Completion failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("LITELLM_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
