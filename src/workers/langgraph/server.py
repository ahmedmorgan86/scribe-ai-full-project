"""
LangGraph Generation Pipeline - FastAPI Server

This is the HTTP wrapper for the LangGraph content generation workflow.
It exposes endpoints that the Next.js application can call to:
- Generate content from source material
- Check pipeline health
- Debug graph execution
- Retrieve intermediate states (checkpointing)

Architecture:
- Next.js calls this service via HTTP
- This service runs LangGraph workflows
- Uses LiteLLM gateway for LLM calls (if available) or direct API keys
- Queries Qdrant directly for vector operations
- Persists graph state to SQLite for debugging
"""

import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse

from checkpointing import SQLiteCheckpointer, get_checkpointer
from graphs.content_generation import run_content_generation, SourceMaterial as GraphSourceMaterial

load_dotenv()

logging.basicConfig(
    level=logging.DEBUG if os.getenv("LOG_LEVEL") == "debug" else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("langgraph-worker")


class Config:
    """Service configuration from environment variables."""

    QDRANT_URL: str = os.getenv("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY: str | None = os.getenv("QDRANT_API_KEY") or None
    LITELLM_GATEWAY_URL: str = os.getenv("LITELLM_GATEWAY_URL", "http://localhost:8001")
    USE_LITELLM_GATEWAY: bool = os.getenv("USE_LITELLM_GATEWAY", "false").lower() == "true"
    ANTHROPIC_API_KEY: str | None = os.getenv("ANTHROPIC_API_KEY")
    OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")
    PORT: int = int(os.getenv("LANGGRAPH_WORKER_PORT", "8002"))


config = Config()

qdrant_client: QdrantClient | None = None
http_client: httpx.AsyncClient | None = None
checkpointer: SQLiteCheckpointer | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage service lifecycle - initialize and cleanup resources."""
    global qdrant_client, http_client, checkpointer

    logger.info("Starting LangGraph worker...")
    logger.info(f"Qdrant URL: {config.QDRANT_URL}")
    logger.info(f"LiteLLM Gateway: {config.LITELLM_GATEWAY_URL} (enabled: {config.USE_LITELLM_GATEWAY})")

    qdrant_client = QdrantClient(
        url=config.QDRANT_URL,
        api_key=config.QDRANT_API_KEY,
        timeout=30,
    )

    http_client = httpx.AsyncClient(timeout=120.0)

    checkpointer = get_checkpointer()
    logger.info(f"Checkpointer initialized: {checkpointer.db_path}")

    deleted = checkpointer.cleanup_old_checkpoints(max_age_hours=48)
    if deleted > 0:
        logger.info(f"Cleaned up {deleted} old checkpoints")

    logger.info("LangGraph worker started successfully")
    yield

    logger.info("Shutting down LangGraph worker...")
    if http_client:
        await http_client.aclose()
    logger.info("LangGraph worker stopped")


app = FastAPI(
    title="LangGraph Generation Pipeline",
    description="Content generation workflow with cyclic feedback loops",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(description="Service health status: healthy | degraded | unavailable")
    qdrant_connected: bool = Field(description="Qdrant connection status")
    litellm_available: bool = Field(description="LiteLLM gateway availability")
    anthropic_configured: bool = Field(description="Anthropic API key configured")
    openai_configured: bool = Field(description="OpenAI API key configured")
    timestamp: str = Field(description="Health check timestamp")


class SourceMaterial(BaseModel):
    """Input source material for content generation."""

    id: str = Field(description="Source ID from database")
    content: str = Field(description="Source text content")
    source_type: str = Field(description="Type: like | bookmark | scraped")
    author: str | None = Field(default=None, description="Original author handle")
    url: str | None = Field(default=None, description="Original URL if available")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class GenerationRequest(BaseModel):
    """Content generation request."""

    sources: list[SourceMaterial] = Field(description="Source materials to generate from")
    content_type: str = Field(default="standalone", description="Type: standalone | thread | quote_tweet")
    formula_id: str | None = Field(default=None, description="Specific formula to use (optional)")
    max_rewrites: int = Field(default=3, description="Maximum rewrite cycles before rejection")
    debug: bool = Field(default=False, description="Include debug trace in response")


class GenerationResult(BaseModel):
    """Generated content result."""

    id: str = Field(description="Generation job ID")
    status: str = Field(description="Status: success | rejected | error")
    content: str | None = Field(default=None, description="Generated content")
    content_type: str = Field(description="Type: standalone | thread | quote_tweet")
    thread_tweets: list[str] | None = Field(default=None, description="Thread tweets if thread type")
    confidence: dict[str, float] = Field(
        default_factory=dict,
        description="Confidence scores: voice, hook, topic, originality",
    )
    reasoning: dict[str, Any] = Field(default_factory=dict, description="Generation reasoning")
    rewrite_count: int = Field(default=0, description="Number of rewrites performed")
    rejection_reason: str | None = Field(default=None, description="Reason if rejected")
    debug_trace: list[dict[str, Any]] | None = Field(default=None, description="Graph execution trace")
    duration_ms: int = Field(description="Total generation time in milliseconds")


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Check service health and dependencies."""
    qdrant_ok = False
    litellm_ok = False

    if qdrant_client:
        try:
            qdrant_client.get_collections()
            qdrant_ok = True
        except (UnexpectedResponse, Exception) as e:
            logger.warning(f"Qdrant health check failed: {e}")

    if config.USE_LITELLM_GATEWAY and http_client:
        try:
            response = await http_client.get(f"{config.LITELLM_GATEWAY_URL}/health", timeout=5.0)
            litellm_ok = response.status_code == 200
        except Exception as e:
            logger.warning(f"LiteLLM health check failed: {e}")

    has_llm = bool(config.ANTHROPIC_API_KEY or config.OPENAI_API_KEY)
    status = "healthy" if qdrant_ok and has_llm else ("degraded" if has_llm else "unavailable")

    return HealthResponse(
        status=status,
        qdrant_connected=qdrant_ok,
        litellm_available=litellm_ok,
        anthropic_configured=bool(config.ANTHROPIC_API_KEY),
        openai_configured=bool(config.OPENAI_API_KEY),
        timestamp=datetime.utcnow().isoformat(),
    )


@app.post("/generate", response_model=GenerationResult)
async def generate_content(request: GenerationRequest) -> GenerationResult:
    """
    Generate content using the LangGraph pipeline.

    The pipeline executes these nodes:
    1. analyze_source - Extract key insights
    2. select_formula - Choose content formula
    3. generate_draft - Create initial draft
    4. voice_check - Validate voice match
    5. slop_check - Detect AI slop
    6. critique/rewrite - If checks fail (max 3 cycles)
    7. finalize - Package output

    State is checkpointed at each node for debugging and recovery.
    """
    start_time = datetime.utcnow()
    job_id = str(uuid4())
    thread_id = f"gen_{job_id}"

    logger.info(f"Generation request {job_id}: {len(request.sources)} sources, type={request.content_type}")

    if not request.sources:
        raise HTTPException(status_code=400, detail="At least one source is required")

    graph_sources: list[GraphSourceMaterial] = [
        {
            "id": s.id,
            "content": s.content,
            "source_type": s.source_type,
            "author": s.author,
            "url": s.url,
            "metadata": s.metadata,
        }
        for s in request.sources
    ]

    if checkpointer:
        checkpointer.save_job_metadata(
            job_id=job_id,
            thread_id=thread_id,
            content_type=request.content_type,
            source_count=len(request.sources),
        )

    try:
        result = await run_content_generation(
            sources=graph_sources,
            content_type=request.content_type,
            formula_id=request.formula_id,
            max_rewrites=request.max_rewrites,
            debug=request.debug,
            thread_id=thread_id,
            checkpointer=checkpointer,
        )

        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        thread_tweets = None
        content = result.get("final_content")
        if request.content_type == "thread" and content:
            thread_tweets = [t.strip() for t in content.split("\n\n") if t.strip()]

        if checkpointer:
            checkpointer.complete_job(job_id, result.get("status", "error"))

        return GenerationResult(
            id=job_id,
            status=result.get("status", "error"),
            content=content,
            content_type=request.content_type,
            thread_tweets=thread_tweets,
            confidence=result.get("confidence", {}),
            reasoning=result.get("reasoning", {}),
            rewrite_count=result.get("rewrite_count", 0),
            rejection_reason=result.get("rejection_reason"),
            debug_trace=result.get("trace") if request.debug else None,
            duration_ms=duration_ms,
        )

    except Exception as e:
        logger.error(f"Generation failed for job {job_id}: {e}")
        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        if checkpointer:
            checkpointer.complete_job(job_id, "error", str(e))

        return GenerationResult(
            id=job_id,
            status="error",
            content=None,
            content_type=request.content_type,
            confidence={},
            reasoning={"error": str(e)},
            rewrite_count=0,
            rejection_reason=f"Pipeline error: {e}",
            debug_trace=[{"node": "server", "status": "error", "details": {"error": str(e)}}]
            if request.debug
            else None,
            duration_ms=duration_ms,
        )


class VoiceCheckRequest(BaseModel):
    """Request to check content against voice corpus."""

    content: str = Field(description="Content to check")
    threshold: float = Field(default=0.7, description="Minimum similarity threshold")


class VoiceCheckResponse(BaseModel):
    """Voice check result."""

    passes: bool = Field(description="Whether content passes voice check")
    similarity_score: float = Field(description="Similarity to voice corpus (0-1)")
    similar_posts: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Most similar approved posts",
    )


@app.post("/voice-check", response_model=VoiceCheckResponse)
async def check_voice(request: VoiceCheckRequest) -> VoiceCheckResponse:
    """
    Check content against the approved voice corpus in Qdrant.

    This endpoint is used by the LangGraph pipeline for voice validation.
    It queries the approved_posts collection for similar content.
    """
    if not qdrant_client:
        raise HTTPException(status_code=503, detail="Qdrant not connected")

    # TODO: Implement embedding generation and Qdrant search
    # For now, return a stub response

    return VoiceCheckResponse(
        passes=False,
        similarity_score=0.0,
        similar_posts=[],
    )


class DebugTraceResponse(BaseModel):
    """Debug trace for a generation job."""

    job_id: str
    found: bool
    job_info: dict[str, Any] | None = None
    checkpoints: list[dict[str, Any]] | None = None
    trace: list[dict[str, Any]] | None = None


class CheckpointStateResponse(BaseModel):
    """Response containing checkpoint state details."""

    job_id: str
    checkpoint_id: str
    found: bool
    state: dict[str, Any] | None = None
    created_at: str | None = None


@app.get("/debug/{job_id}", response_model=DebugTraceResponse)
async def get_debug_trace(job_id: str) -> DebugTraceResponse:
    """
    Get the execution trace and checkpoints for a generation job.

    Returns:
    - job_info: Metadata about the job (status, timing, etc.)
    - checkpoints: List of intermediate states at each node
    - trace: Execution trace if debug=True was set during generation
    """
    if not checkpointer:
        raise HTTPException(status_code=503, detail="Checkpointer not available")

    job_info = checkpointer.get_job_info(job_id)
    if not job_info:
        return DebugTraceResponse(
            job_id=job_id,
            found=False,
            job_info=None,
            checkpoints=None,
            trace=None,
        )

    checkpoints = checkpointer.get_job_checkpoints(job_id)

    trace = None
    if checkpoints:
        last_checkpoint = checkpoints[-1]
        state = last_checkpoint.get("state", {})
        if isinstance(state, dict):
            channel_values = state.get("channel_values", state)
            trace = channel_values.get("trace", [])

    return DebugTraceResponse(
        job_id=job_id,
        found=True,
        job_info=job_info,
        checkpoints=checkpoints,
        trace=trace,
    )


@app.get("/debug/{job_id}/checkpoint/{checkpoint_id}", response_model=CheckpointStateResponse)
async def get_checkpoint_state(job_id: str, checkpoint_id: str) -> CheckpointStateResponse:
    """
    Get a specific checkpoint state for detailed inspection.

    Useful for debugging specific nodes in the execution flow.
    """
    if not checkpointer:
        raise HTTPException(status_code=503, detail="Checkpointer not available")

    job_info = checkpointer.get_job_info(job_id)
    if not job_info:
        return CheckpointStateResponse(
            job_id=job_id,
            checkpoint_id=checkpoint_id,
            found=False,
        )

    checkpoints = checkpointer.get_job_checkpoints(job_id)
    for cp in checkpoints:
        if cp.get("checkpoint_id") == checkpoint_id:
            return CheckpointStateResponse(
                job_id=job_id,
                checkpoint_id=checkpoint_id,
                found=True,
                state=cp.get("state"),
                created_at=cp.get("created_at"),
            )

    return CheckpointStateResponse(
        job_id=job_id,
        checkpoint_id=checkpoint_id,
        found=False,
    )


@app.get("/jobs", response_model=list[dict[str, Any]])
async def list_recent_jobs(limit: int = 20) -> list[dict[str, Any]]:
    """
    List recent generation jobs.

    Useful for browsing job history and finding jobs to debug.
    """
    if not checkpointer:
        raise HTTPException(status_code=503, detail="Checkpointer not available")

    conn = checkpointer._get_conn()
    rows = conn.execute(
        """
        SELECT job_id, thread_id, status, content_type, source_count,
               started_at, completed_at, final_status, error
        FROM job_metadata
        ORDER BY started_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    return [dict(row) for row in rows]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=config.PORT,
        reload=os.getenv("NODE_ENV") == "development",
        log_level="debug" if os.getenv("LOG_LEVEL") == "debug" else "info",
    )
