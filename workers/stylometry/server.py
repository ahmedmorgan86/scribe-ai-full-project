"""
Stylometric Analysis Service - FastAPI Server

Provides stylometric analysis endpoints for voice authenticity verification.
Wraps the core analyzer module for HTTP access.

Architecture:
- Standalone FastAPI service for stylometric analysis
- Called by LangGraph worker and Next.js for voice validation
- Stateless - all analysis performed per-request
"""

import os
import sys
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.health import HealthChecker, HealthCheckResponse, DependencyStatus
from .analyzer import (
    analyze_stylometry as analyze_stylometry_core,
    sentence_length_distribution as sentence_length_distribution_core,
    punctuation_fingerprint as punctuation_fingerprint_core,
    vocabulary_richness as vocabulary_richness_core,
    function_word_distribution as function_word_distribution_core,
    syntactic_complexity as syntactic_complexity_core,
    compare_analyses as compare_analyses_core,
    analysis_to_dict,
)

load_dotenv()

logging.basicConfig(
    level=logging.DEBUG if os.getenv("LOG_LEVEL") == "debug" else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("stylometry-worker")

SERVICE_VERSION = "1.0.0"
health_checker: HealthChecker | None = None


class Config:
    """Service configuration from environment variables."""

    PORT: int = int(os.getenv("STYLOMETRY_WORKER_PORT", "8003"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")


config = Config()


class SentenceLengthStats(BaseModel):
    """Sentence length distribution statistics."""

    mean: float = Field(description="Mean words per sentence")
    std_dev: float = Field(description="Standard deviation of sentence lengths")
    min: int = Field(description="Minimum sentence length")
    max: int = Field(description="Maximum sentence length")
    count: int = Field(description="Number of sentences")
    distribution: list[int] = Field(description="Word counts per sentence")


class PunctuationFingerprint(BaseModel):
    """Punctuation frequency fingerprint."""

    period: int = Field(description="Period count")
    comma: int = Field(description="Comma count")
    exclamation: int = Field(description="Exclamation mark count")
    question: int = Field(description="Question mark count")
    hyphen: int = Field(description="Hyphen count")
    em_dash: int = Field(description="Em dash count")
    ellipsis: int = Field(description="Ellipsis count")
    semicolon: int = Field(description="Semicolon count")
    colon: int = Field(description="Colon count")
    total: int = Field(description="Total punctuation count")


class VocabularyRichnessStats(BaseModel):
    """Vocabulary richness metrics."""

    type_token_ratio: float = Field(description="Unique words / total words")
    hapax_legomena: int = Field(description="Words appearing exactly once")
    hapax_ratio: float = Field(description="Hapax / unique words")
    total_words: int = Field(description="Total word count")
    unique_words: int = Field(description="Unique word count")


class FunctionWordDistribution(BaseModel):
    """Function word frequency distribution (Burrows' Delta basis)."""

    the: float = 0.0
    and_: float = Field(default=0.0, alias="and")
    but: float = 0.0
    of: float = 0.0
    to: float = 0.0
    a: float = 0.0
    in_: float = Field(default=0.0, alias="in")
    that: float = 0.0
    is_: float = Field(default=0.0, alias="is")
    it: float = 0.0
    for_: float = Field(default=0.0, alias="for")
    as_: float = Field(default=0.0, alias="as")
    with_: float = Field(default=0.0, alias="with")
    was: float = 0.0
    be: float = 0.0
    by: float = 0.0
    on: float = 0.0
    not_: float = Field(default=0.0, alias="not")
    or_: float = Field(default=0.0, alias="or")
    are: float = 0.0
    total: int = Field(description="Total word count")

    class Config:
        populate_by_name = True


class SyntacticComplexityStats(BaseModel):
    """Syntactic complexity metrics."""

    avg_clause_depth: float = Field(description="Average subordinate clause count per sentence")
    avg_words_per_clause: float = Field(description="Average words per clause")
    subordinate_clause_ratio: float = Field(description="Subordinate clauses / total clauses")


class StylometricAnalysis(BaseModel):
    """Complete stylometric analysis result."""

    sentence_length: SentenceLengthStats
    punctuation: PunctuationFingerprint
    vocabulary: VocabularyRichnessStats
    function_words: FunctionWordDistribution
    syntactic: SyntacticComplexityStats


class AnalyzeRequest(BaseModel):
    """Request to analyze text stylometry."""

    text: str = Field(description="Text to analyze")


class AnalyzeResponse(BaseModel):
    """Stylometric analysis response."""

    success: bool = Field(description="Whether analysis succeeded")
    analysis: StylometricAnalysis | None = Field(default=None, description="Analysis results")
    error: str | None = Field(default=None, description="Error message if failed")


class CompareRequest(BaseModel):
    """Request to compare two texts stylometrically."""

    text_a: str = Field(description="First text")
    text_b: str = Field(description="Second text")


class CompareResponse(BaseModel):
    """Stylometric comparison response."""

    success: bool
    similarity_score: float = Field(description="Overall similarity (0-1)")
    dimension_scores: dict[str, float] = Field(description="Per-dimension similarity scores")
    analysis_a: StylometricAnalysis | None = None
    analysis_b: StylometricAnalysis | None = None
    error: str | None = None




def convert_to_pydantic_analysis(analysis_dict: dict) -> StylometricAnalysis:
    """Convert analyzer dict to Pydantic model."""
    return StylometricAnalysis(
        sentence_length=SentenceLengthStats(
            mean=analysis_dict["sentence_length"]["mean"],
            std_dev=analysis_dict["sentence_length"]["std_dev"],
            min=analysis_dict["sentence_length"]["min"],
            max=analysis_dict["sentence_length"]["max"],
            count=analysis_dict["sentence_length"]["count"],
            distribution=analysis_dict["sentence_length"]["distribution"],
        ),
        punctuation=PunctuationFingerprint(
            period=analysis_dict["punctuation"]["period"],
            comma=analysis_dict["punctuation"]["comma"],
            exclamation=analysis_dict["punctuation"]["exclamation"],
            question=analysis_dict["punctuation"]["question"],
            hyphen=analysis_dict["punctuation"]["hyphen"],
            em_dash=analysis_dict["punctuation"]["em_dash"],
            ellipsis=analysis_dict["punctuation"]["ellipsis"],
            semicolon=analysis_dict["punctuation"]["semicolon"],
            colon=analysis_dict["punctuation"]["colon"],
            total=analysis_dict["punctuation"]["total"],
        ),
        vocabulary=VocabularyRichnessStats(
            type_token_ratio=analysis_dict["vocabulary"]["type_token_ratio"],
            hapax_legomena=analysis_dict["vocabulary"]["hapax_legomena"],
            hapax_ratio=analysis_dict["vocabulary"]["hapax_ratio"],
            total_words=analysis_dict["vocabulary"]["total_words"],
            unique_words=analysis_dict["vocabulary"]["unique_words"],
        ),
        function_words=FunctionWordDistribution(
            the=analysis_dict["function_words"]["the"],
            and_=analysis_dict["function_words"]["and"],
            but=analysis_dict["function_words"]["but"],
            of=analysis_dict["function_words"]["of"],
            to=analysis_dict["function_words"]["to"],
            a=analysis_dict["function_words"]["a"],
            in_=analysis_dict["function_words"]["in"],
            that=analysis_dict["function_words"]["that"],
            is_=analysis_dict["function_words"]["is"],
            it=analysis_dict["function_words"]["it"],
            for_=analysis_dict["function_words"]["for"],
            as_=analysis_dict["function_words"]["as"],
            with_=analysis_dict["function_words"]["with"],
            was=analysis_dict["function_words"]["was"],
            be=analysis_dict["function_words"]["be"],
            by=analysis_dict["function_words"]["by"],
            on=analysis_dict["function_words"]["on"],
            not_=analysis_dict["function_words"]["not"],
            or_=analysis_dict["function_words"]["or"],
            are=analysis_dict["function_words"]["are"],
            total=analysis_dict["function_words"]["total"],
        ),
        syntactic=SyntacticComplexityStats(
            avg_clause_depth=analysis_dict["syntactic"]["avg_clause_depth"],
            avg_words_per_clause=analysis_dict["syntactic"]["avg_words_per_clause"],
            subordinate_clause_ratio=analysis_dict["syntactic"]["subordinate_clause_ratio"],
        ),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage service lifecycle."""
    global health_checker
    logger.info("Starting Stylometry worker...")
    logger.info(f"Port: {config.PORT}")
    health_checker = HealthChecker(service_name="stylometry-worker", version=SERVICE_VERSION)
    logger.info("Stylometry worker started successfully")
    yield
    logger.info("Stylometry worker stopped")


app = FastAPI(
    title="Stylometric Analysis Service",
    description="Voice authenticity verification through stylometric analysis",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthCheckResponse)
async def health_check() -> HealthCheckResponse:
    """
    Check service health.

    Stylometry service is stateless - health is determined by:
    - Service uptime (indicates stability)
    - Analyzer module availability
    """
    if not health_checker:
        return HealthCheckResponse(
            service="stylometry-worker",
            status="unavailable",
            version=SERVICE_VERSION,
            timestamp=datetime.utcnow().isoformat(),
            uptime_seconds=0,
            dependencies=[],
            checks={},
        )

    dependencies: list[DependencyStatus] = []

    try:
        test_text = "This is a test sentence."
        analyze_stylometry_core(test_text)
        dependencies.append(
            DependencyStatus(
                name="analyzer",
                status="healthy",
                details={"module": "stylometry.analyzer"},
            )
        )
    except Exception as e:
        dependencies.append(
            DependencyStatus(
                name="analyzer",
                status="unavailable",
                details={"error": str(e)},
            )
        )

    checks = {
        "analyzer_functional": dependencies[0].status == "healthy" if dependencies else False,
    }

    return health_checker.build_response(dependencies, checks)


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Perform stylometric analysis on text.

    Returns metrics for:
    - Sentence length distribution
    - Punctuation fingerprint
    - Vocabulary richness
    - Function word distribution
    - Syntactic complexity
    """
    try:
        if not request.text or not request.text.strip():
            return AnalyzeResponse(
                success=False,
                analysis=None,
                error="Empty text provided",
            )

        analysis = analyze_stylometry_core(request.text)
        analysis_dict = analysis_to_dict(analysis)
        pydantic_analysis = convert_to_pydantic_analysis(analysis_dict)

        return AnalyzeResponse(
            success=True,
            analysis=pydantic_analysis,
            error=None,
        )
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        return AnalyzeResponse(
            success=False,
            analysis=None,
            error=str(e),
        )


@app.post("/compare", response_model=CompareResponse)
async def compare_texts(request: CompareRequest) -> CompareResponse:
    """
    Compare stylometric similarity between two texts.

    Returns overall similarity score (0-1) and per-dimension breakdown.
    """
    try:
        if not request.text_a.strip() or not request.text_b.strip():
            return CompareResponse(
                success=False,
                similarity_score=0.0,
                dimension_scores={},
                error="Empty text provided",
            )

        analysis_a = analyze_stylometry_core(request.text_a)
        analysis_b = analyze_stylometry_core(request.text_b)

        comparison = compare_analyses_core(analysis_a, analysis_b)

        analysis_a_dict = analysis_to_dict(analysis_a)
        analysis_b_dict = analysis_to_dict(analysis_b)

        return CompareResponse(
            success=True,
            similarity_score=comparison.overall_similarity,
            dimension_scores=comparison.dimension_scores,
            analysis_a=convert_to_pydantic_analysis(analysis_a_dict),
            analysis_b=convert_to_pydantic_analysis(analysis_b_dict),
            error=None,
        )
    except Exception as e:
        logger.error(f"Comparison failed: {e}")
        return CompareResponse(
            success=False,
            similarity_score=0.0,
            dimension_scores={},
            error=str(e),
        )


@app.post("/sentence-length")
async def get_sentence_length(request: AnalyzeRequest) -> dict:
    """Get sentence length distribution only."""
    result = sentence_length_distribution_core(request.text)
    return {
        "mean": result.mean,
        "std_dev": result.std_dev,
        "min": result.min_length,
        "max": result.max_length,
        "count": result.count,
        "distribution": result.distribution,
    }


@app.post("/punctuation")
async def get_punctuation(request: AnalyzeRequest) -> dict:
    """Get punctuation fingerprint only."""
    result = punctuation_fingerprint_core(request.text)
    return {
        "period": result.period,
        "comma": result.comma,
        "exclamation": result.exclamation,
        "question": result.question,
        "hyphen": result.hyphen,
        "em_dash": result.em_dash,
        "ellipsis": result.ellipsis,
        "semicolon": result.semicolon,
        "colon": result.colon,
        "total": result.total,
    }


@app.post("/vocabulary")
async def get_vocabulary(request: AnalyzeRequest) -> dict:
    """Get vocabulary richness metrics only."""
    result = vocabulary_richness_core(request.text)
    return {
        "type_token_ratio": result.type_token_ratio,
        "hapax_legomena": result.hapax_legomena,
        "hapax_ratio": result.hapax_ratio,
        "total_words": result.total_words,
        "unique_words": result.unique_words,
    }


@app.post("/function-words")
async def get_function_words(request: AnalyzeRequest) -> dict[str, Any]:
    """Get function word distribution only."""
    result = function_word_distribution_core(request.text)
    return {
        "the": result.the,
        "and": result.and_word,
        "but": result.but,
        "of": result.of,
        "to": result.to,
        "a": result.a,
        "in": result.in_word,
        "that": result.that,
        "is": result.is_word,
        "it": result.it,
        "for": result.for_word,
        "as": result.as_word,
        "with": result.with_word,
        "was": result.was,
        "be": result.be,
        "by": result.by,
        "on": result.on,
        "not": result.not_word,
        "or": result.or_word,
        "are": result.are,
        "total": result.total,
    }


@app.post("/syntactic")
async def get_syntactic(request: AnalyzeRequest) -> dict:
    """Get syntactic complexity metrics only."""
    result = syntactic_complexity_core(request.text)
    return {
        "avg_clause_depth": result.avg_clause_depth,
        "avg_words_per_clause": result.avg_words_per_clause,
        "subordinate_clause_ratio": result.subordinate_clause_ratio,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=config.PORT,
        reload=os.getenv("NODE_ENV") == "development",
        log_level="debug" if config.LOG_LEVEL == "debug" else "info",
    )
