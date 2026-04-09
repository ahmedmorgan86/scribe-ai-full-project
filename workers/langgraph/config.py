"""
LLM Model Routing Configuration for LangGraph Worker.

╔═══════════════════════════════════════════════════════════════════════════════╗
║  THIS FILE MUST MIRROR src/lib/llm/config.ts EXACTLY                          ║
║                                                                               ║
║  TypeScript config.ts is the SINGLE SOURCE OF TRUTH.                         ║
║  When updating model config, update config.ts FIRST, then mirror here.       ║
║  Run `npm run validate:llm-config` to verify consistency.                    ║
╚═══════════════════════════════════════════════════════════════════════════════╝

Mirrors:
- Model identifiers
- Task-based routing (fast vs quality)
- Fallback chains
- Model parameters (temperature, max_tokens)
"""

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

from dotenv import load_dotenv

load_dotenv()


class Models(str, Enum):
    """Model identifiers matching src/lib/llm/config.ts MODELS constant."""

    # Fast/Cheap tier - quick tasks where cost matters more than quality
    GPT_4O_MINI = "gpt-4o-mini"

    # Quality tier - content generation where quality is paramount
    CLAUDE_SONNET = "claude-sonnet-4-20250514"
    CLAUDE_OPUS = "claude-opus-4-20250514"
    CLAUDE_HAIKU = "claude-3-5-haiku-20241022"

    # Fallback tier - reliable alternative when primary fails
    GPT_4O = "gpt-4o"


ModelType = Literal["fast", "quality"]
TaskType = Literal["classification", "parsing", "evaluation", "generation", "analysis", "rewrite"]


@dataclass
class ModelTier:
    """Model tier configuration matching TypeScript ModelTier interface."""

    primary: str
    fallbacks: list[str]
    max_tokens: int
    temperature: float


MODEL_ROUTING: dict[TaskType, ModelTier] = {
    "classification": ModelTier(
        primary=Models.GPT_4O_MINI,
        fallbacks=[Models.CLAUDE_HAIKU],
        max_tokens=256,
        temperature=0.1,
    ),
    "parsing": ModelTier(
        primary=Models.GPT_4O_MINI,
        fallbacks=[Models.CLAUDE_HAIKU],
        max_tokens=1024,
        temperature=0.0,
    ),
    "evaluation": ModelTier(
        primary=Models.GPT_4O_MINI,
        fallbacks=[Models.CLAUDE_HAIKU, Models.GPT_4O],
        max_tokens=512,
        temperature=0.2,
    ),
    "generation": ModelTier(
        primary=Models.CLAUDE_SONNET,
        fallbacks=[Models.GPT_4O, Models.CLAUDE_OPUS],
        max_tokens=4096,
        temperature=0.7,
    ),
    "analysis": ModelTier(
        primary=Models.CLAUDE_SONNET,
        fallbacks=[Models.GPT_4O],
        max_tokens=2048,
        temperature=0.3,
    ),
    "rewrite": ModelTier(
        primary=Models.CLAUDE_SONNET,
        fallbacks=[Models.GPT_4O],
        max_tokens=4096,
        temperature=0.5,
    ),
}

MODEL_COSTS: dict[str, dict[str, float]] = {
    Models.GPT_4O_MINI: {"input": 0.15, "output": 0.6},
    Models.GPT_4O: {"input": 2.5, "output": 10.0},
    Models.CLAUDE_HAIKU: {"input": 0.25, "output": 1.25},
    Models.CLAUDE_SONNET: {"input": 3.0, "output": 15.0},
    Models.CLAUDE_OPUS: {"input": 15.0, "output": 75.0},
}


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
class LLMConfig:
    """LLM configuration loaded from environment."""

    anthropic_api_key: str | None = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY"))
    openai_api_key: str | None = field(default_factory=lambda: os.getenv("OPENAI_API_KEY"))
    use_litellm_gateway: bool = field(default_factory=_should_use_gateway)
    litellm_gateway_url: str = field(
        default_factory=lambda: os.getenv("LITELLM_GATEWAY_URL", "http://localhost:8001")
    )

    def is_model_available(self, model: str) -> bool:
        """Check if a model is available based on API key configuration."""
        if model.startswith("claude"):
            return bool(self.anthropic_api_key)
        if model.startswith("gpt"):
            return bool(self.openai_api_key)
        return False

    def get_available_models(self) -> list[str]:
        """Get all available models based on configured API keys."""
        return [m.value for m in Models if self.is_model_available(m.value)]

    def get_best_available_model(self, task_type: TaskType) -> str | None:
        """Get the best available model for a task, considering API key availability."""
        tier = MODEL_ROUTING[task_type]

        if self.is_model_available(tier.primary):
            return tier.primary

        for fallback in tier.fallbacks:
            if self.is_model_available(fallback):
                return fallback

        return None

    def build_fallback_chain(self, task_type: TaskType) -> list[str]:
        """Build a fallback chain for a task type, filtering by availability."""
        tier = MODEL_ROUTING[task_type]
        chain: list[str] = []

        if self.is_model_available(tier.primary):
            chain.append(tier.primary)

        for fallback in tier.fallbacks:
            if self.is_model_available(fallback):
                chain.append(fallback)

        return chain


_config: LLMConfig | None = None


def get_llm_config() -> LLMConfig:
    """Get LLM configuration singleton."""
    global _config
    if _config is None:
        _config = LLMConfig()
    return _config


def reset_llm_config() -> None:
    """Reset LLM configuration (for testing)."""
    global _config
    _config = None


def get_model_for_task(task_type: TaskType) -> ModelTier:
    """Get the model configuration for a given task type."""
    return MODEL_ROUTING[task_type]


def get_primary_model(task_type: TaskType) -> str:
    """Get the primary model ID for a task type."""
    return MODEL_ROUTING[task_type].primary


def get_fallback_models(task_type: TaskType) -> list[str]:
    """Get fallback models for a task type."""
    return MODEL_ROUTING[task_type].fallbacks


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost for a completion based on model and token counts."""
    costs = MODEL_COSTS.get(model, {"input": 0.0, "output": 0.0})
    return (input_tokens / 1_000_000) * costs["input"] + (output_tokens / 1_000_000) * costs["output"]


def get_model_for_type(model_type: ModelType) -> tuple[str, float, int]:
    """
    Get model settings for a model type (fast/quality).

    Returns: (model_id, temperature, max_tokens)

    This maps the simple fast/quality types used in content_generation.py
    to the full task-based routing system.
    """
    if model_type == "fast":
        tier = MODEL_ROUTING["classification"]
    else:
        tier = MODEL_ROUTING["generation"]

    config = get_llm_config()
    model = config.get_best_available_model("classification" if model_type == "fast" else "generation")

    if model is None:
        raise ValueError("No LLM API keys configured")

    return model, tier.temperature, tier.max_tokens


def get_config_as_json() -> dict:
    """
    Export the complete LLM configuration as a JSON-serializable dict.
    Used by validation scripts to ensure this config mirrors TypeScript.
    """
    return {
        "models": {
            "GPT_4O_MINI": Models.GPT_4O_MINI.value,
            "CLAUDE_SONNET": Models.CLAUDE_SONNET.value,
            "CLAUDE_OPUS": Models.CLAUDE_OPUS.value,
            "CLAUDE_HAIKU": Models.CLAUDE_HAIKU.value,
            "GPT_4O": Models.GPT_4O.value,
        },
        "routing": {
            task_type: {
                "primary": tier.primary,
                "fallbacks": tier.fallbacks,
                "maxTokens": tier.max_tokens,
                "temperature": tier.temperature,
            }
            for task_type, tier in MODEL_ROUTING.items()
        },
        "costs": {
            model: {"input": costs["input"], "output": costs["output"]}
            for model, costs in MODEL_COSTS.items()
        },
    }
