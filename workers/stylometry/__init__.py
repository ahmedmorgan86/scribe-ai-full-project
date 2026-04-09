# Stylometric Analysis Service Worker
# Provides FastAPI endpoints for voice authenticity verification
# through stylometric analysis: sentence structure, punctuation, vocabulary.

from .analyzer import (
    analyze_stylometry,
    sentence_length_distribution,
    punctuation_fingerprint,
    vocabulary_richness,
    function_word_distribution,
    syntactic_complexity,
    compare_analyses,
    compare_texts,
    analysis_to_dict,
    StylometricAnalysis,
    SentenceLengthStats,
    PunctuationFingerprint,
    VocabularyRichnessStats,
    FunctionWordDistribution,
    SyntacticComplexityStats,
    ComparisonResult,
)

__all__ = [
    # Analysis functions
    "analyze_stylometry",
    "sentence_length_distribution",
    "punctuation_fingerprint",
    "vocabulary_richness",
    "function_word_distribution",
    "syntactic_complexity",
    # Comparison functions
    "compare_analyses",
    "compare_texts",
    # Utility functions
    "analysis_to_dict",
    # Data classes
    "StylometricAnalysis",
    "SentenceLengthStats",
    "PunctuationFingerprint",
    "VocabularyRichnessStats",
    "FunctionWordDistribution",
    "SyntacticComplexityStats",
    "ComparisonResult",
]
