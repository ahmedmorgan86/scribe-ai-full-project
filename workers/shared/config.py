"""
Shared configuration utilities for Python workers.

Provides common environment variable loading and configuration
across all worker services.
"""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


def _should_use_gateway() -> bool:
    """
    Determine if LiteLLM gateway should be used.
    Respects LLM_ROUTING_MODE (preferred) or USE_LITELLM_GATEWAY (deprecated).
    """
    routing_mode = os.getenv("LLM_ROUTING_MODE", "").lower()
    if routing_mode == "gateway":
        return True
    if routing_mode == "direct":
        return False
    # Fallback to deprecated USE_LITELLM_GATEWAY for backwards compatibility
    return os.getenv("USE_LITELLM_GATEWAY", "false").lower() == "true"


@dataclass
class BaseConfig:
    """Base configuration shared by all workers."""

    # Qdrant Vector Database
    QDRANT_URL: str = os.getenv("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY: str | None = os.getenv("QDRANT_API_KEY") or None

    # LiteLLM Gateway
    LITELLM_GATEWAY_URL: str = os.getenv("LITELLM_GATEWAY_URL", "http://localhost:8001")
    USE_LITELLM_GATEWAY: bool = _should_use_gateway()

    # LLM API Keys
    ANTHROPIC_API_KEY: str | None = os.getenv("ANTHROPIC_API_KEY")
    OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")

    # Next.js Application
    NEXTJS_URL: str = os.getenv("NEXTJS_URL", "http://localhost:3000")

    # Data Directory
    DATA_DIR: str = os.getenv("DATA_DIR", "./data")

    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")


def get_base_config() -> BaseConfig:
    """Get base configuration instance."""
    return BaseConfig()
