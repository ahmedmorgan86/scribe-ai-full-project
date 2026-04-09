"""
LangGraph Content Generation Pipeline

This module implements the cyclic content generation workflow with feedback loops.
The graph processes source material through multiple validation stages with
automatic rewrite cycles when content fails checks.

Graph Flow:
    analyze_source → select_formula → generate_draft
                                           ↓
                                      voice_check
                                           ↓ (pass)      ↓ (fail)
                                      slop_check      critique
                                           ↓ (pass)      ↓
                                    stylometric_check → rewrite → (back to voice_check)
                                           ↓ (pass)
                                        finalize

Max 3 rewrite cycles before rejection.
"""

import os
import sys
import logging
from typing import Literal, TypedDict, Any
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.base import BaseCheckpointSaver

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import get_llm_config, get_model_for_task, MODEL_ROUTING

load_dotenv()

logger = logging.getLogger("langgraph.content_generation")

MAX_REWRITE_CYCLES = 3

# Thresholds cache - fetched from TypeScript API on first use
_thresholds_cache: dict[str, Any] | None = None


def get_thresholds() -> dict[str, Any]:
    """
    Fetch validation thresholds from TypeScript API.

    TypeScript config is the SINGLE SOURCE OF TRUTH for thresholds.
    Python fetches thresholds via /api/config/thresholds endpoint.
    Results are cached to avoid repeated API calls.

    Returns default values if API is unavailable.
    """
    global _thresholds_cache

    if _thresholds_cache is not None:
        return _thresholds_cache

    # Default values matching TypeScript defaults
    defaults = {
        "voice": {"similarity": 0.7, "minConfidence": 70, "minDimensionScore": 50, "contrastThreshold": 0.6},
        "slop": {"maxScore": 30, "warningScore": 20, "semanticThreshold": 0.85},
        "stylometry": {"similarity": 0.7, "minDimensions": 3, "maxDrift": 0.15},
        "duplicate": {"postSimilarity": 0.8, "sourceSimilarity": 0.85},
        "learning": {"stuckBaseThreshold": 5, "patternSimilarity": 0.5},
    }

    try:
        nextjs_url = os.getenv("NEXTJS_URL", "http://localhost:3000")
        api_url = f"{nextjs_url}/api/config/thresholds"

        response = httpx.get(api_url, timeout=5.0)

        if response.status_code == 200:
            data = response.json()
            _thresholds_cache = data.get("thresholds", defaults)
            logger.info("Loaded thresholds from TypeScript API")
            return _thresholds_cache
        else:
            logger.warning(f"Thresholds API returned status {response.status_code}, using defaults")
            _thresholds_cache = defaults
            return _thresholds_cache

    except Exception as e:
        logger.warning(f"Failed to fetch thresholds from API: {e}, using defaults")
        _thresholds_cache = defaults
        return _thresholds_cache


def reset_thresholds_cache() -> None:
    """Reset thresholds cache (for testing)."""
    global _thresholds_cache
    _thresholds_cache = None


def get_voice_similarity_threshold() -> float:
    """Get voice similarity threshold from centralized config."""
    return get_thresholds()["voice"]["similarity"]


def get_slop_max_score() -> int:
    """Get slop max score threshold from centralized config."""
    return get_thresholds()["slop"]["maxScore"]


def get_stylometric_threshold() -> float:
    """Get stylometric similarity threshold from centralized config."""
    return get_thresholds()["stylometry"]["similarity"]


class SourceMaterial(TypedDict):
    """Input source material for content generation."""
    id: str
    content: str
    source_type: str
    author: str | None
    url: str | None
    metadata: dict[str, Any]


class ConfidenceScores(TypedDict):
    """Confidence breakdown for generated content."""
    voice: float
    hook: float
    topic: float
    originality: float
    overall: float


class TraceEntry(TypedDict):
    """Single entry in the execution trace."""
    node: str
    timestamp: str
    duration_ms: int
    status: str
    details: dict[str, Any]


class GraphState(TypedDict):
    """State passed between nodes in the generation graph."""
    sources: list[SourceMaterial]
    content_type: str
    formula_id: str | None
    max_rewrites: int
    debug: bool

    key_insights: list[str]
    selected_formula: dict[str, Any] | None
    draft_content: str
    current_content: str

    voice_check_passed: bool
    voice_similarity: float
    voice_feedback: str
    similar_posts: list[dict[str, Any]]

    slop_check_passed: bool
    slop_score: float
    slop_issues: list[str]
    slop_feedback: str

    stylometric_check_passed: bool
    stylometric_score: float
    stylometric_feedback: str

    critique: str
    rewrite_count: int

    final_content: str
    confidence: ConfidenceScores
    reasoning: dict[str, Any]
    status: Literal["success", "rejected", "error"]
    rejection_reason: str | None

    trace: list[TraceEntry]
    error: str | None


def get_config() -> dict[str, Any]:
    """Get configuration from environment."""
    return {
        "litellm_gateway_url": os.getenv("LITELLM_GATEWAY_URL", "http://localhost:8001"),
        "use_litellm_gateway": os.getenv("USE_LITELLM_GATEWAY", "false").lower() == "true",
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY"),
        "openai_api_key": os.getenv("OPENAI_API_KEY"),
        "nextjs_url": os.getenv("NEXTJS_URL", "http://localhost:3000"),
    }


class GatewayLLM:
    """
    LLM wrapper that routes through LiteLLM HTTP gateway.

    Compatible with LangChain message interface but routes all
    requests through the centralized LiteLLM gateway service.
    """

    def __init__(self, model: str, gateway_url: str, temperature: float = 0.7, max_tokens: int = 2048):
        self.model = model
        self.gateway_url = gateway_url.rstrip("/")
        self.temperature = temperature
        self.max_tokens = max_tokens

    def _convert_messages(self, messages: list) -> list[dict]:
        """Convert LangChain messages to dict format for gateway."""
        result = []
        for msg in messages:
            if isinstance(msg, SystemMessage):
                result.append({"role": "system", "content": msg.content})
            elif isinstance(msg, HumanMessage):
                result.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                result.append({"role": "assistant", "content": msg.content})
            elif isinstance(msg, dict):
                result.append(msg)
            else:
                result.append({"role": "user", "content": str(msg.content)})
        return result

    def invoke(self, messages: list) -> AIMessage:
        """Synchronous invoke via gateway."""
        converted = self._convert_messages(messages)

        try:
            response = httpx.post(
                f"{self.gateway_url}/completion",
                json={
                    "model": self.model,
                    "messages": converted,
                    "max_tokens": self.max_tokens,
                    "temperature": self.temperature,
                },
                timeout=120.0,
            )
            response.raise_for_status()
            data = response.json()
            return AIMessage(content=data.get("content", ""))
        except httpx.HTTPStatusError as e:
            logger.error(f"Gateway HTTP error: {e.response.status_code} - {e.response.text}")
            raise ValueError(f"Gateway request failed: {e.response.status_code}")
        except httpx.RequestError as e:
            logger.error(f"Gateway connection error: {e}")
            raise ValueError(f"Gateway connection failed: {e}")

    async def ainvoke(self, messages: list) -> AIMessage:
        """Async invoke via gateway."""
        converted = self._convert_messages(messages)

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.gateway_url}/completion",
                    json={
                        "model": self.model,
                        "messages": converted,
                        "max_tokens": self.max_tokens,
                        "temperature": self.temperature,
                    },
                    timeout=120.0,
                )
                response.raise_for_status()
                data = response.json()
                return AIMessage(content=data.get("content", ""))
            except httpx.HTTPStatusError as e:
                logger.error(f"Gateway HTTP error: {e.response.status_code} - {e.response.text}")
                raise ValueError(f"Gateway request failed: {e.response.status_code}")
            except httpx.RequestError as e:
                logger.error(f"Gateway connection error: {e}")
                raise ValueError(f"Gateway connection failed: {e}")


def get_llm(model_type: Literal["fast", "quality"] = "quality") -> GatewayLLM | ChatAnthropic | ChatOpenAI:
    """
    Get LLM instance based on task type.

    Routes through LiteLLM gateway when USE_LITELLM_GATEWAY=true,
    otherwise falls back to direct API calls.

    Uses config.py for model selection to ensure consistency with TypeScript config.
    """
    llm_config = get_llm_config()
    env_config = get_config()

    task_type = "classification" if model_type == "fast" else "generation"
    tier = MODEL_ROUTING[task_type]
    model = llm_config.get_best_available_model(task_type)

    if model is None:
        raise ValueError("No LLM API keys configured")

    if llm_config.use_litellm_gateway:
        logger.info(f"Using LiteLLM gateway for model: {model}")
        return GatewayLLM(
            model=model,
            gateway_url=llm_config.litellm_gateway_url,
            temperature=tier.temperature,
            max_tokens=tier.max_tokens,
        )

    if model.startswith("claude"):
        return ChatAnthropic(
            model=model,
            api_key=env_config["anthropic_api_key"],
            temperature=tier.temperature,
            max_tokens=tier.max_tokens,
        )

    if model.startswith("gpt"):
        return ChatOpenAI(
            model=model,
            api_key=env_config["openai_api_key"],
            temperature=tier.temperature,
        )

    raise ValueError(f"Unknown model type: {model}")


def add_trace(state: GraphState, node: str, status: str, details: dict[str, Any], start_time: datetime) -> None:
    """Add entry to execution trace."""
    if state["debug"]:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        state["trace"].append({
            "node": node,
            "timestamp": start_time.isoformat(),
            "duration_ms": duration_ms,
            "status": status,
            "details": details,
        })


def analyze_source(state: GraphState) -> GraphState:
    """
    Extract key insights from source material.

    Analyzes the source content to identify:
    - Main topic and key points
    - Potential hooks and angles
    - Content type suitability
    """
    start_time = datetime.now(timezone.utc)

    try:
        llm = get_llm("fast")
        sources_text = "\n\n---\n\n".join([
            f"Source ({s['source_type']}): {s['content']}"
            for s in state["sources"]
        ])

        messages = [
            SystemMessage(content="""You are a content analyst. Extract key insights from source material for social media content creation.

Return your analysis as a JSON object with this structure:
{
    "key_insights": ["insight 1", "insight 2", ...],
    "main_topic": "brief topic description",
    "potential_hooks": ["hook 1", "hook 2"],
    "suggested_angle": "unique angle to take",
    "timing_notes": "any time-sensitive considerations"
}

Focus on:
- What makes this content valuable
- What unique perspective can be added
- What pain points it addresses"""),
            HumanMessage(content=f"Analyze these sources:\n\n{sources_text}"),
        ]

        response = llm.invoke(messages)

        import json
        try:
            analysis = json.loads(response.content)
            key_insights = analysis.get("key_insights", [])
        except (json.JSONDecodeError, TypeError):
            content_text = str(response.content) if response.content else ""
            key_insights = [content_text[:500]] if content_text else ["Source material analyzed"]

        state["key_insights"] = key_insights
        add_trace(state, "analyze_source", "success", {"insights_count": len(key_insights)}, start_time)

    except Exception as e:
        logger.error(f"analyze_source error: {e}")
        state["key_insights"] = ["Analysis failed - using source directly"]
        state["error"] = str(e)
        add_trace(state, "analyze_source", "error", {"error": str(e)}, start_time)

    return state


def select_formula(state: GraphState) -> GraphState:
    """
    Choose content formula based on source type and insights.

    Matches source material characteristics to available formulas:
    - Problem → AI Solution
    - Hidden Gem Discovery
    - Contrarian/Surprising Take
    - Simplifier
    - The Bridge
    """
    start_time = datetime.now(timezone.utc)

    formulas = [
        {
            "name": "Problem → AI Solution",
            "template": "You're probably still doing [task] manually. Here's how to automate it with [tool]: [steps]. [result]",
            "triggers": ["manual", "automate", "tool", "workflow", "time-consuming"],
        },
        {
            "name": "Hidden Gem Discovery",
            "template": "Found a GitHub repo with only [X] stars that [solves problem]. [What it does]. [How to install]. Link: [url]",
            "triggers": ["github", "repo", "star", "discover", "found", "gem"],
        },
        {
            "name": "Contrarian/Surprising Take",
            "template": "Unpopular opinion: [common practice] is wrong. Here's why: [reasoning]. Instead, try [alternative].",
            "triggers": ["actually", "wrong", "instead", "but", "myth", "misconception"],
        },
        {
            "name": "Simplifier",
            "template": "[Complex concept] explained simply: [explanation]. That's it. Not more complicated.",
            "triggers": ["explain", "simple", "complex", "understand", "confusing"],
        },
        {
            "name": "The Bridge",
            "template": "[Group A] struggles with [problem]. [Group B] has solved this with [solution]. Here's how to apply it: [steps]",
            "triggers": ["like", "similar", "apply", "transfer", "crossover"],
        },
    ]

    if state.get("formula_id"):
        for formula in formulas:
            if formula["name"] == state["formula_id"]:
                state["selected_formula"] = formula
                add_trace(state, "select_formula", "success", {"formula": formula["name"], "method": "forced"}, start_time)
                return state

    source_content = " ".join([s["content"].lower() for s in state["sources"]])
    insights_text = " ".join(state.get("key_insights", [])).lower()
    combined_text = f"{source_content} {insights_text}"

    best_match = None
    best_score = 0

    for formula in formulas:
        score = sum(1 for trigger in formula["triggers"] if trigger in combined_text)
        if score > best_score:
            best_score = score
            best_match = formula

    if not best_match:
        best_match = formulas[0]

    state["selected_formula"] = best_match
    add_trace(state, "select_formula", "success", {"formula": best_match["name"], "score": best_score}, start_time)

    return state


def generate_draft(state: GraphState) -> GraphState:
    """
    Create initial draft using selected formula and voice guidelines.

    Generates content following:
    - Selected formula structure
    - Voice guidelines from Qdrant
    - Key insights from analysis
    """
    start_time = datetime.now(timezone.utc)

    try:
        llm = get_llm("quality")

        formula = state.get("selected_formula", {})
        formula_name = formula.get("name", "General")
        formula_template = formula.get("template", "")

        sources_summary = "\n".join([
            f"- {s['content'][:300]}..." if len(s['content']) > 300 else f"- {s['content']}"
            for s in state["sources"]
        ])

        insights_text = "\n".join([f"- {insight}" for insight in state.get("key_insights", [])])

        content_type = state.get("content_type", "standalone")
        max_length = "280 characters" if content_type == "standalone" else "5-7 tweets for a thread"

        system_prompt = f"""You are a skilled Twitter/X content creator. Generate authentic, engaging content.

VOICE GUIDELINES:
- Be conversational and direct
- Use problem-first framing
- Never use hashtags
- Never use generic AI phrases like "Let's dive in", "Here's the thing", "Game-changer"
- Never cite Reddit or HackerNews as sources
- Add unique value - don't just restate

FORMULA: {formula_name}
Template: {formula_template}

CONTENT TYPE: {content_type}
MAX LENGTH: {max_length}

Return your response as JSON:
{{
    "content": "the generated post/thread content",
    "hook": "the opening hook used",
    "why_it_works": "brief explanation",
    "concerns": ["any concerns or caveats"]
}}"""

        user_prompt = f"""Generate content from these sources:

{sources_summary}

KEY INSIGHTS:
{insights_text}

Apply the {formula_name} formula to create engaging content."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]

        response = llm.invoke(messages)

        import json
        try:
            result = json.loads(response.content)
            content = result.get("content", "")
            reasoning = {
                "hook": result.get("hook", ""),
                "why_it_works": result.get("why_it_works", ""),
                "concerns": result.get("concerns", []),
            }
        except (json.JSONDecodeError, TypeError):
            content = str(response.content) if response.content else ""
            reasoning = {"hook": "", "why_it_works": "Generated from formula", "concerns": []}

        state["draft_content"] = content
        state["current_content"] = content
        state["reasoning"] = {
            **reasoning,
            "formula": formula_name,
            "sources": [s["id"] for s in state["sources"]],
        }
        add_trace(state, "generate_draft", "success", {"content_length": len(content)}, start_time)

    except Exception as e:
        logger.error(f"generate_draft error: {e}")
        state["error"] = str(e)
        state["status"] = "error"
        add_trace(state, "generate_draft", "error", {"error": str(e)}, start_time)

    return state


def voice_check(state: GraphState) -> GraphState:
    """
    Validate content against voice corpus via TypeScript API.

    Calls the Next.js API to validate content against the voice corpus.
    This ensures consistency between TypeScript and Python validation logic.

    Checks:
    - Semantic similarity to approved posts
    - Alignment with voice guidelines
    - Returns pass/fail with similarity score
    """
    start_time = datetime.now(timezone.utc)
    content = state.get("current_content", "")

    if not content:
        state["voice_check_passed"] = False
        state["voice_similarity"] = 0.0
        state["voice_feedback"] = "No content to check"
        state["similar_posts"] = []
        add_trace(state, "voice_check", "fail", {"reason": "no_content"}, start_time)
        return state

    try:
        nextjs_url = os.getenv("NEXTJS_URL", "http://localhost:3000")
        api_url = f"{nextjs_url}/api/voice/check"

        response = httpx.post(
            api_url,
            json={
                "content": content,
                "threshold": get_voice_similarity_threshold(),
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            logger.warning(f"Voice check API returned status {response.status_code}")
            state["voice_check_passed"] = True
            state["voice_similarity"] = 0.0
            state["voice_feedback"] = f"Voice check skipped - API error ({response.status_code})"
            state["similar_posts"] = []
            add_trace(state, "voice_check", "skip", {"reason": f"api_error_{response.status_code}"}, start_time)
            return state

        data = response.json()

        if not data.get("success"):
            logger.warning(f"Voice check failed: {data.get('error')}")
            state["voice_check_passed"] = True
            state["voice_similarity"] = 0.0
            state["voice_feedback"] = f"Voice check skipped - {data.get('error', 'Unknown error')}"
            state["similar_posts"] = []
            add_trace(state, "voice_check", "skip", {"reason": "api_failure", "error": data.get("error")}, start_time)
            return state

        result = data.get("result", {})
        passed = result.get("pass", True)
        similarity = result.get("similarity", 0.0)
        feedback = result.get("feedback", "")
        corpus_available = result.get("corpusAvailable", False)
        top_matches = result.get("topMatches", [])

        state["voice_check_passed"] = passed
        state["voice_similarity"] = similarity
        state["voice_feedback"] = feedback
        state["similar_posts"] = top_matches

        add_trace(
            state,
            "voice_check",
            "success" if passed else "fail",
            {
                "similarity": similarity,
                "threshold": get_voice_similarity_threshold(),
                "corpus_available": corpus_available,
                "match_count": len(top_matches),
            },
            start_time,
        )

    except httpx.TimeoutException:
        logger.warning("Voice check API timeout")
        state["voice_check_passed"] = True
        state["voice_similarity"] = 0.0
        state["voice_feedback"] = "Voice check skipped - API timeout"
        state["similar_posts"] = []
        add_trace(state, "voice_check", "skip", {"reason": "timeout"}, start_time)

    except httpx.RequestError as e:
        logger.warning(f"Voice check API connection error: {e}")
        state["voice_check_passed"] = True
        state["voice_similarity"] = 0.0
        state["voice_feedback"] = "Voice check skipped - API unavailable"
        state["similar_posts"] = []
        add_trace(state, "voice_check", "skip", {"reason": "connection_error", "error": str(e)}, start_time)

    except Exception as e:
        logger.error(f"Voice check error: {e}")
        state["voice_check_passed"] = True
        state["voice_similarity"] = 0.0
        state["voice_feedback"] = f"Voice check error: {e}"
        state["similar_posts"] = []
        add_trace(state, "voice_check", "error", {"error": str(e)}, start_time)

    return state


def slop_check(state: GraphState) -> GraphState:
    """
    Run slop detection via TypeScript API.

    Calls the Next.js API to detect AI-generated slop patterns.
    This ensures consistency between TypeScript and Python validation logic.

    Checks for:
    - Banned AI phrases
    - Structural patterns (listicle, emoji spam)
    - Semantic similarity to known AI corpus
    - Voice contrast deviation
    """
    start_time = datetime.now(timezone.utc)
    content = state.get("current_content", "")

    if not content:
        state["slop_check_passed"] = False
        state["slop_score"] = 100.0
        state["slop_issues"] = ["No content to check"]
        state["slop_feedback"] = "No content provided"
        add_trace(state, "slop_check", "fail", {"reason": "no_content"}, start_time)
        return state

    try:
        nextjs_url = os.getenv("NEXTJS_URL", "http://localhost:3000")
        api_url = f"{nextjs_url}/api/slop/detect"

        response = httpx.post(
            api_url,
            json={
                "content": content,
                "threshold": get_slop_max_score(),
                "skipSemantic": False,
                "skipVoiceContrast": False,
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            logger.warning(f"Slop detection API returned status {response.status_code}")
            state["slop_check_passed"] = True
            state["slop_score"] = 0.0
            state["slop_issues"] = []
            state["slop_feedback"] = f"Slop check skipped - API error ({response.status_code})"
            add_trace(state, "slop_check", "skip", {"reason": f"api_error_{response.status_code}"}, start_time)
            return state

        data = response.json()

        if not data.get("success"):
            logger.warning(f"Slop detection failed: {data.get('error')}")
            state["slop_check_passed"] = True
            state["slop_score"] = 0.0
            state["slop_issues"] = []
            state["slop_feedback"] = f"Slop check skipped - {data.get('error', 'Unknown error')}"
            add_trace(state, "slop_check", "skip", {"reason": "api_failure", "error": data.get("error")}, start_time)
            return state

        result = data.get("result", {})
        passed = result.get("pass", True)
        score = result.get("score", 0.0)
        feedback = result.get("feedback", "")
        issues = [issue.get("description", "") for issue in result.get("issues", [])]
        detected_by = result.get("detectedBy", [])

        state["slop_check_passed"] = passed
        state["slop_score"] = score
        state["slop_issues"] = issues
        state["slop_feedback"] = feedback

        add_trace(
            state,
            "slop_check",
            "success" if passed else "fail",
            {
                "score": score,
                "threshold": get_slop_max_score(),
                "issues": issues,
                "detected_by": detected_by,
            },
            start_time,
        )

    except httpx.TimeoutException:
        logger.warning("Slop detection API timeout")
        state["slop_check_passed"] = True
        state["slop_score"] = 0.0
        state["slop_issues"] = []
        state["slop_feedback"] = "Slop check skipped - API timeout"
        add_trace(state, "slop_check", "skip", {"reason": "timeout"}, start_time)

    except httpx.RequestError as e:
        logger.warning(f"Slop detection API connection error: {e}")
        state["slop_check_passed"] = True
        state["slop_score"] = 0.0
        state["slop_issues"] = []
        state["slop_feedback"] = "Slop check skipped - API unavailable"
        add_trace(state, "slop_check", "skip", {"reason": "connection_error", "error": str(e)}, start_time)

    except Exception as e:
        logger.error(f"Slop check error: {e}")
        state["slop_check_passed"] = True
        state["slop_score"] = 0.0
        state["slop_issues"] = []
        state["slop_feedback"] = f"Slop check error: {e}"
        add_trace(state, "slop_check", "error", {"error": str(e)}, start_time)

    return state


def stylometric_check(state: GraphState) -> GraphState:
    """
    Run stylometric verification on content.

    Calls the Next.js API to validate content against the persona's
    stylometric signature. Checks:
    - Sentence length distribution
    - Punctuation patterns
    - Vocabulary richness
    - Function word distribution
    - Syntactic complexity
    """
    start_time = datetime.now(timezone.utc)
    content = state.get("current_content", "")

    if not content:
        state["stylometric_check_passed"] = False
        state["stylometric_score"] = 0.0
        state["stylometric_feedback"] = "No content to check"
        add_trace(state, "stylometric_check", "fail", {"reason": "no_content"}, start_time)
        return state

    try:
        nextjs_url = os.getenv("NEXTJS_URL", "http://localhost:3000")
        api_url = f"{nextjs_url}/api/stylometric/validate"

        response = httpx.post(
            api_url,
            json={
                "content": content,
                "threshold": get_stylometric_threshold(),
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            logger.warning(f"Stylometric API returned status {response.status_code}")
            state["stylometric_check_passed"] = True
            state["stylometric_score"] = 0.0
            state["stylometric_feedback"] = f"Stylometric check skipped - API error ({response.status_code})"
            add_trace(state, "stylometric_check", "skip", {"reason": f"api_error_{response.status_code}"}, start_time)
            return state

        data = response.json()

        if not data.get("success"):
            logger.warning(f"Stylometric validation failed: {data.get('error')}")
            state["stylometric_check_passed"] = True
            state["stylometric_score"] = 0.0
            state["stylometric_feedback"] = f"Stylometric check skipped - {data.get('error', 'Unknown error')}"
            add_trace(state, "stylometric_check", "skip", {"reason": "api_failure", "error": data.get("error")}, start_time)
            return state

        result = data.get("result", {})
        passed = result.get("pass", True)
        score = result.get("score", 0.0)
        feedback = result.get("feedback", "")
        dimension_scores = result.get("dimensionScores", {})

        state["stylometric_check_passed"] = passed
        state["stylometric_score"] = score
        state["stylometric_feedback"] = feedback if not passed else f"Stylometric match: {score:.1%}"

        add_trace(
            state,
            "stylometric_check",
            "success" if passed else "fail",
            {
                "score": score,
                "threshold": get_stylometric_threshold(),
                "dimensions": dimension_scores,
                "feedback": feedback,
            },
            start_time,
        )

    except httpx.TimeoutException:
        logger.warning("Stylometric API timeout")
        state["stylometric_check_passed"] = True
        state["stylometric_score"] = 0.0
        state["stylometric_feedback"] = "Stylometric check skipped - API timeout"
        add_trace(state, "stylometric_check", "skip", {"reason": "timeout"}, start_time)

    except httpx.RequestError as e:
        logger.warning(f"Stylometric API connection error: {e}")
        state["stylometric_check_passed"] = True
        state["stylometric_score"] = 0.0
        state["stylometric_feedback"] = "Stylometric check skipped - API unavailable"
        add_trace(state, "stylometric_check", "skip", {"reason": "connection_error", "error": str(e)}, start_time)

    except Exception as e:
        logger.error(f"Stylometric check error: {e}")
        state["stylometric_check_passed"] = True
        state["stylometric_score"] = 0.0
        state["stylometric_feedback"] = f"Stylometric check error: {e}"
        add_trace(state, "stylometric_check", "error", {"error": str(e)}, start_time)

    return state


def critique(state: GraphState) -> GraphState:
    """
    Generate improvement feedback when checks fail.

    Analyzes failures from:
    - Voice check
    - Slop check
    - Stylometric check

    Produces specific, actionable feedback for rewrite.
    """
    start_time = datetime.now(timezone.utc)

    try:
        feedback_parts: list[str] = []

        if not state.get("voice_check_passed", True):
            feedback_parts.append(f"Voice: {state.get('voice_feedback', 'Does not match voice corpus')}")

        if not state.get("slop_check_passed", True):
            issues = state.get("slop_issues", [])
            feedback_parts.append(f"Slop issues: {', '.join(issues)}")

        if not state.get("stylometric_check_passed", True):
            feedback_parts.append(f"Style: {state.get('stylometric_feedback', 'Style mismatch')}")

        if not feedback_parts:
            feedback_parts.append("Content needs improvement")

        llm = get_llm("fast")

        messages = [
            SystemMessage(content="""You are a content editor. Given feedback about content issues,
provide specific, actionable suggestions for improvement. Be concise and direct."""),
            HumanMessage(content=f"""Original content:
{state.get('current_content', '')}

Issues found:
{chr(10).join(feedback_parts)}

Provide 2-3 specific suggestions to fix these issues while maintaining the core message."""),
        ]

        response = llm.invoke(messages)
        critique_text = str(response.content) if response.content else "Revise content to address flagged issues"

        state["critique"] = f"Issues: {'; '.join(feedback_parts)}\n\nSuggestions: {critique_text}"
        add_trace(state, "critique", "success", {"issues_count": len(feedback_parts)}, start_time)

    except Exception as e:
        logger.error(f"critique error: {e}")
        state["critique"] = f"Rewrite needed: {state.get('slop_feedback', '')} {state.get('voice_feedback', '')}"
        add_trace(state, "critique", "error", {"error": str(e)}, start_time)

    return state


def rewrite(state: GraphState) -> GraphState:
    """
    Incorporate critique and regenerate content.

    Uses the critique feedback to produce an improved version
    while maintaining the original insight and formula structure.
    """
    start_time = datetime.now(timezone.utc)

    try:
        llm = get_llm("quality")

        rewrite_count = state.get("rewrite_count", 0) + 1
        state["rewrite_count"] = rewrite_count

        formula = state.get("selected_formula", {})
        formula_name = formula.get("name", "General")

        system_prompt = """You are a skilled content editor. Rewrite the content to address the critique while:
- Keeping the core message and insight
- Maintaining the same general structure
- Following voice guidelines (conversational, direct, no hashtags, no AI slop)
- Staying within length limits

Return only the rewritten content, no explanations."""

        user_prompt = f"""Original content:
{state.get('current_content', '')}

Critique:
{state.get('critique', '')}

Formula being used: {formula_name}

Rewrite this content to address the issues. Return only the improved content."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]

        response = llm.invoke(messages)
        new_content = str(response.content).strip() if response.content else state.get("current_content", "")

        state["current_content"] = new_content
        add_trace(state, "rewrite", "success", {"rewrite_number": rewrite_count, "content_length": len(new_content)}, start_time)

    except Exception as e:
        logger.error(f"rewrite error: {e}")
        state["error"] = str(e)
        add_trace(state, "rewrite", "error", {"error": str(e)}, start_time)

    return state


def finalize(state: GraphState) -> GraphState:
    """
    Package final output with reasoning and confidence scores.

    Computes confidence breakdown:
    - Voice match %
    - Hook quality %
    - Topic relevance %
    - Originality %
    """
    start_time = datetime.now(timezone.utc)

    content = state.get("current_content", "")

    voice_score = state.get("voice_similarity", 0.7) * 100
    slop_score = state.get("slop_score", 0)
    originality_score = max(0, 100 - slop_score)

    hook_score = 70.0
    if content:
        first_line = content.split("\n")[0] if "\n" in content else content[:50]
        if any(c in first_line for c in ["?", "!", ":"]):
            hook_score += 10
        if len(first_line) < 100:
            hook_score += 10

    topic_score = 75.0
    if state.get("key_insights"):
        topic_score = min(95, 70 + len(state["key_insights"]) * 5)

    overall = (voice_score + hook_score + topic_score + originality_score) / 4

    state["final_content"] = content
    state["confidence"] = {
        "voice": round(voice_score, 1),
        "hook": round(hook_score, 1),
        "topic": round(topic_score, 1),
        "originality": round(originality_score, 1),
        "overall": round(overall, 1),
    }
    state["status"] = "success"
    state["rejection_reason"] = None

    reasoning = state.get("reasoning", {})
    reasoning["rewrite_count"] = state.get("rewrite_count", 0)
    reasoning["voice_similarity"] = state.get("voice_similarity", 0)
    reasoning["slop_score"] = state.get("slop_score", 0)
    reasoning["stylometric_score"] = state.get("stylometric_score", 0)
    reasoning["stylometric_feedback"] = state.get("stylometric_feedback", "")
    state["reasoning"] = reasoning

    add_trace(state, "finalize", "success", {
        "confidence": state["confidence"],
        "stylometric_score": state.get("stylometric_score", 0),
    }, start_time)

    return state


def reject(state: GraphState) -> GraphState:
    """
    Handle rejection when max rewrites exceeded.

    Sets status to rejected and provides explanation.
    """
    start_time = datetime.now(timezone.utc)

    reasons: list[str] = []
    if not state.get("voice_check_passed", True):
        reasons.append(state.get("voice_feedback", "Voice mismatch"))
    if not state.get("slop_check_passed", True):
        reasons.append(f"Slop detected: {', '.join(state.get('slop_issues', []))}")
    if not state.get("stylometric_check_passed", True):
        reasons.append(state.get("stylometric_feedback", "Style mismatch"))

    state["status"] = "rejected"
    state["rejection_reason"] = f"Max rewrites ({state.get('rewrite_count', 0)}) exceeded. Issues: {'; '.join(reasons)}"
    state["final_content"] = state.get("current_content", "")
    state["confidence"] = {
        "voice": 0.0,
        "hook": 0.0,
        "topic": 0.0,
        "originality": 0.0,
        "overall": 0.0,
    }

    add_trace(state, "reject", "rejected", {"reason": state["rejection_reason"]}, start_time)

    return state


def should_continue_after_voice(state: GraphState) -> Literal["slop_check", "critique"]:
    """Route after voice check: pass → slop_check, fail → critique."""
    if state.get("voice_check_passed", False):
        return "slop_check"
    return "critique"


def should_continue_after_slop(state: GraphState) -> Literal["stylometric_check", "critique"]:
    """Route after slop check: pass → stylometric_check, fail → critique."""
    if state.get("slop_check_passed", False):
        return "stylometric_check"
    return "critique"


def should_continue_after_stylometric(state: GraphState) -> Literal["finalize", "critique"]:
    """Route after stylometric check: pass → finalize, fail → critique."""
    if state.get("stylometric_check_passed", False):
        return "finalize"
    return "critique"


def should_continue_after_rewrite(state: GraphState) -> Literal["voice_check", "reject"]:
    """Route after rewrite: under max → voice_check, over max → reject."""
    max_rewrites = state.get("max_rewrites", MAX_REWRITE_CYCLES)
    if state.get("rewrite_count", 0) < max_rewrites:
        return "voice_check"
    return "reject"


def build_content_generation_graph() -> StateGraph:
    """
    Build the LangGraph content generation workflow.

    Returns a compiled graph ready for execution.
    """
    graph = StateGraph(GraphState)

    graph.add_node("analyze_source", analyze_source)
    graph.add_node("select_formula", select_formula)
    graph.add_node("generate_draft", generate_draft)
    graph.add_node("voice_check", voice_check)
    graph.add_node("slop_check", slop_check)
    graph.add_node("stylometric_check", stylometric_check)
    graph.add_node("critique", critique)
    graph.add_node("rewrite", rewrite)
    graph.add_node("finalize", finalize)
    graph.add_node("reject", reject)

    graph.set_entry_point("analyze_source")
    graph.add_edge("analyze_source", "select_formula")
    graph.add_edge("select_formula", "generate_draft")
    graph.add_edge("generate_draft", "voice_check")

    graph.add_conditional_edges(
        "voice_check",
        should_continue_after_voice,
        {"slop_check": "slop_check", "critique": "critique"},
    )

    graph.add_conditional_edges(
        "slop_check",
        should_continue_after_slop,
        {"stylometric_check": "stylometric_check", "critique": "critique"},
    )

    graph.add_conditional_edges(
        "stylometric_check",
        should_continue_after_stylometric,
        {"finalize": "finalize", "critique": "critique"},
    )

    graph.add_edge("critique", "rewrite")

    graph.add_conditional_edges(
        "rewrite",
        should_continue_after_rewrite,
        {"voice_check": "voice_check", "reject": "reject"},
    )

    graph.add_edge("finalize", END)
    graph.add_edge("reject", END)

    return graph


def create_initial_state(
    sources: list[SourceMaterial],
    content_type: str = "standalone",
    formula_id: str | None = None,
    max_rewrites: int = MAX_REWRITE_CYCLES,
    debug: bool = False,
) -> GraphState:
    """Create initial state for graph execution."""
    return {
        "sources": sources,
        "content_type": content_type,
        "formula_id": formula_id,
        "max_rewrites": max_rewrites,
        "debug": debug,
        "key_insights": [],
        "selected_formula": None,
        "draft_content": "",
        "current_content": "",
        "voice_check_passed": False,
        "voice_similarity": 0.0,
        "voice_feedback": "",
        "similar_posts": [],
        "slop_check_passed": False,
        "slop_score": 0.0,
        "slop_issues": [],
        "slop_feedback": "",
        "stylometric_check_passed": False,
        "stylometric_score": 0.0,
        "stylometric_feedback": "",
        "critique": "",
        "rewrite_count": 0,
        "final_content": "",
        "confidence": {"voice": 0.0, "hook": 0.0, "topic": 0.0, "originality": 0.0, "overall": 0.0},
        "reasoning": {},
        "status": "error",
        "rejection_reason": None,
        "trace": [],
        "error": None,
    }


memory = MemorySaver()
content_generation_graph = build_content_generation_graph().compile(checkpointer=memory)


def compile_graph_with_checkpointer(checkpointer: BaseCheckpointSaver | None = None):
    """
    Compile the content generation graph with a custom checkpointer.

    Args:
        checkpointer: Custom checkpoint saver. If None, uses in-memory MemorySaver.

    Returns:
        Compiled graph ready for execution.
    """
    if checkpointer is None:
        checkpointer = MemorySaver()
    return build_content_generation_graph().compile(checkpointer=checkpointer)


async def run_content_generation(
    sources: list[SourceMaterial],
    content_type: str = "standalone",
    formula_id: str | None = None,
    max_rewrites: int = MAX_REWRITE_CYCLES,
    debug: bool = False,
    thread_id: str | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
) -> GraphState:
    """
    Execute the content generation pipeline.

    Args:
        sources: List of source materials to generate from
        content_type: Type of content (standalone, thread, quote_tweet)
        formula_id: Optional specific formula to use
        max_rewrites: Maximum rewrite cycles before rejection
        debug: Include execution trace in response
        thread_id: Optional thread ID for checkpointing
        checkpointer: Optional custom checkpointer for persistent state storage

    Returns:
        Final graph state with generated content or rejection reason
    """
    initial_state = create_initial_state(
        sources=sources,
        content_type=content_type,
        formula_id=formula_id,
        max_rewrites=max_rewrites,
        debug=debug,
    )

    config = {"configurable": {"thread_id": thread_id or "default"}}

    if checkpointer is not None:
        graph = compile_graph_with_checkpointer(checkpointer)
    else:
        graph = content_generation_graph

    final_state = await graph.ainvoke(initial_state, config)

    return final_state


if __name__ == "__main__":
    import asyncio

    async def test_generation():
        """Test the content generation pipeline."""
        test_sources: list[SourceMaterial] = [
            {
                "id": "test-1",
                "content": "Most developers waste hours manually setting up CI/CD pipelines. There's a tool that automates the entire process in 5 minutes.",
                "source_type": "like",
                "author": "testuser",
                "url": None,
                "metadata": {},
            }
        ]

        result = await run_content_generation(
            sources=test_sources,
            content_type="standalone",
            debug=True,
        )

        print(f"Status: {result['status']}")
        print(f"Content: {result.get('final_content', 'N/A')}")
        print(f"Confidence: {result.get('confidence', {})}")
        print(f"Rewrite count: {result.get('rewrite_count', 0)}")
        if result.get("rejection_reason"):
            print(f"Rejection reason: {result['rejection_reason']}")
        if result.get("trace"):
            print(f"Trace: {len(result['trace'])} entries")

    asyncio.run(test_generation())
