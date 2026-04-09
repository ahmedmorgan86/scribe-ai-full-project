"""
Stylometric Analyzer - Core Analysis Functions

Provides pure Python stylometric analysis functions for voice authenticity verification.
This module is stateless and can be used independently of the FastAPI server.

Architecture:
- No dependencies on FastAPI/Pydantic - pure Python dataclasses
- Mirrors TypeScript implementation in src/lib/voice/stylometry.ts
- Used by server.py for HTTP endpoints and LangGraph worker for direct calls
"""

import math
import re
from dataclasses import dataclass, field


SENTENCE_TERMINATORS = re.compile(r"[.!?]+")
WORD_PATTERN = re.compile(r"\b[a-zA-Z']+\b")

SUBORDINATE_MARKERS = [
    "although", "because", "since", "unless", "whereas", "while",
    "when", "where", "if", "that", "which", "who", "whom", "whose",
    "after", "before", "until", "whenever", "wherever",
]

FUNCTION_WORDS = [
    "the", "and", "but", "of", "to", "a", "in", "that", "is", "it",
    "for", "as", "with", "was", "be", "by", "on", "not", "or", "are",
]


@dataclass
class SentenceLengthStats:
    """Sentence length distribution statistics."""
    mean: float = 0.0
    std_dev: float = 0.0
    min_length: int = 0
    max_length: int = 0
    count: int = 0
    distribution: list[int] = field(default_factory=list)


@dataclass
class PunctuationFingerprint:
    """Punctuation frequency fingerprint."""
    period: int = 0
    comma: int = 0
    exclamation: int = 0
    question: int = 0
    hyphen: int = 0
    em_dash: int = 0
    ellipsis: int = 0
    semicolon: int = 0
    colon: int = 0
    total: int = 0


@dataclass
class VocabularyRichnessStats:
    """Vocabulary richness metrics."""
    type_token_ratio: float = 0.0
    hapax_legomena: int = 0
    hapax_ratio: float = 0.0
    total_words: int = 0
    unique_words: int = 0


@dataclass
class FunctionWordDistribution:
    """Function word frequency distribution (Burrows' Delta basis)."""
    the: float = 0.0
    and_word: float = 0.0  # 'and' is a reserved word
    but: float = 0.0
    of: float = 0.0
    to: float = 0.0
    a: float = 0.0
    in_word: float = 0.0  # 'in' is a reserved word
    that: float = 0.0
    is_word: float = 0.0  # 'is' is a reserved word
    it: float = 0.0
    for_word: float = 0.0  # 'for' is a reserved word
    as_word: float = 0.0  # 'as' is a reserved word
    with_word: float = 0.0  # 'with' is a reserved word
    was: float = 0.0
    be: float = 0.0
    by: float = 0.0
    on: float = 0.0
    not_word: float = 0.0  # 'not' is a reserved word
    or_word: float = 0.0  # 'or' is a reserved word
    are: float = 0.0
    total: int = 0


@dataclass
class SyntacticComplexityStats:
    """Syntactic complexity metrics."""
    avg_clause_depth: float = 0.0
    avg_words_per_clause: float = 0.0
    subordinate_clause_ratio: float = 0.0


@dataclass
class StylometricAnalysis:
    """Complete stylometric analysis result."""
    sentence_length: SentenceLengthStats
    punctuation: PunctuationFingerprint
    vocabulary: VocabularyRichnessStats
    function_words: FunctionWordDistribution
    syntactic: SyntacticComplexityStats


@dataclass
class ComparisonResult:
    """Result of comparing two stylometric analyses."""
    overall_similarity: float
    dimension_scores: dict[str, float]


def split_into_sentences(text: str) -> list[str]:
    """Split text into sentences using terminal punctuation."""
    normalized = re.sub(r"\s+", " ", text).strip()
    sentences = SENTENCE_TERMINATORS.split(normalized)
    return [s.strip() for s in sentences if s.strip()]


def extract_words(text: str) -> list[str]:
    """Extract all words from text, lowercased."""
    matches = WORD_PATTERN.findall(text.lower())
    return matches


def calculate_mean(values: list[float]) -> float:
    """Calculate arithmetic mean."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def calculate_std_dev(values: list[float], mean: float) -> float:
    """Calculate population standard deviation."""
    if len(values) <= 1:
        return 0.0
    squared_diffs = [(v - mean) ** 2 for v in values]
    variance = sum(squared_diffs) / len(values)
    return math.sqrt(variance)


def sentence_length_distribution(text: str) -> SentenceLengthStats:
    """
    Analyze sentence length distribution.

    Returns statistics about word counts per sentence including
    mean, standard deviation, min, max, and full distribution.
    """
    sentences = split_into_sentences(text)
    word_counts = [len(extract_words(s)) for s in sentences]

    if not word_counts:
        return SentenceLengthStats()

    mean = calculate_mean([float(c) for c in word_counts])
    std_dev = calculate_std_dev([float(c) for c in word_counts], mean)

    return SentenceLengthStats(
        mean=round(mean, 2),
        std_dev=round(std_dev, 2),
        min_length=min(word_counts),
        max_length=max(word_counts),
        count=len(word_counts),
        distribution=word_counts,
    )


def punctuation_fingerprint(text: str) -> PunctuationFingerprint:
    """
    Generate punctuation frequency fingerprint.

    Tracks 9 punctuation types: . , ! ? - — ... ; :
    """
    def count_pattern(pattern: str) -> int:
        return len(re.findall(pattern, text))

    period = count_pattern(r"(?<!\.\.)\.(?!\.)")  # single dots only
    comma = count_pattern(r",")
    exclamation = count_pattern(r"!")
    question = count_pattern(r"\?")
    hyphen = count_pattern(r"(?<![—-])-(?![—-])")  # single hyphens only
    em_dash = count_pattern(r"—|--")
    ellipsis = count_pattern(r"\.{3}|…")
    semicolon = count_pattern(r";")
    colon = count_pattern(r":")

    total = period + comma + exclamation + question + hyphen + em_dash + ellipsis + semicolon + colon

    return PunctuationFingerprint(
        period=period,
        comma=comma,
        exclamation=exclamation,
        question=question,
        hyphen=hyphen,
        em_dash=em_dash,
        ellipsis=ellipsis,
        semicolon=semicolon,
        colon=colon,
        total=total,
    )


def vocabulary_richness(text: str) -> VocabularyRichnessStats:
    """
    Calculate vocabulary richness metrics.

    Returns type-token ratio and hapax legomena statistics.
    """
    words = extract_words(text)
    total_words = len(words)

    if total_words == 0:
        return VocabularyRichnessStats()

    word_frequency: dict[str, int] = {}
    for word in words:
        word_frequency[word] = word_frequency.get(word, 0) + 1

    unique_words = len(word_frequency)
    hapax_count = sum(1 for count in word_frequency.values() if count == 1)

    type_token_ratio = unique_words / total_words
    hapax_ratio = hapax_count / unique_words if unique_words > 0 else 0.0

    return VocabularyRichnessStats(
        type_token_ratio=round(type_token_ratio, 3),
        hapax_legomena=hapax_count,
        hapax_ratio=round(hapax_ratio, 3),
        total_words=total_words,
        unique_words=unique_words,
    )


def function_word_distribution(text: str) -> FunctionWordDistribution:
    """
    Analyze function word distribution.

    Tracks 20 common function words as proportions of total words.
    This forms the basis for Burrows' Delta stylometric comparison.
    """
    words = extract_words(text)
    total_words = len(words)

    counts: dict[str, int] = {fw: 0 for fw in FUNCTION_WORDS}
    for word in words:
        if word in counts:
            counts[word] += 1

    def normalize(count: int) -> float:
        if total_words == 0:
            return 0.0
        return round(count / total_words, 4)

    return FunctionWordDistribution(
        the=normalize(counts["the"]),
        and_word=normalize(counts["and"]),
        but=normalize(counts["but"]),
        of=normalize(counts["of"]),
        to=normalize(counts["to"]),
        a=normalize(counts["a"]),
        in_word=normalize(counts["in"]),
        that=normalize(counts["that"]),
        is_word=normalize(counts["is"]),
        it=normalize(counts["it"]),
        for_word=normalize(counts["for"]),
        as_word=normalize(counts["as"]),
        with_word=normalize(counts["with"]),
        was=normalize(counts["was"]),
        be=normalize(counts["be"]),
        by=normalize(counts["by"]),
        on=normalize(counts["on"]),
        not_word=normalize(counts["not"]),
        or_word=normalize(counts["or"]),
        are=normalize(counts["are"]),
        total=total_words,
    )


def syntactic_complexity(text: str) -> SyntacticComplexityStats:
    """
    Estimate syntactic complexity using heuristics.

    Uses subordinate clause markers and comma patterns to estimate
    clause depth and complexity without requiring full NLP parsing.
    """
    sentences = split_into_sentences(text)

    if not sentences:
        return SyntacticComplexityStats()

    total_subordinate_clauses = 0
    total_clauses = 0
    total_words = 0

    for sentence in sentences:
        words = extract_words(sentence)
        word_count = len(words)
        total_words += word_count

        subordinate_count = 0
        for marker in SUBORDINATE_MARKERS:
            pattern = rf"\b{marker}\b"
            matches = re.findall(pattern, sentence, re.IGNORECASE)
            subordinate_count += len(matches)

        commas = len(re.findall(r",", sentence))
        estimated_clauses = max(1, subordinate_count + 1 + commas // 2)

        total_subordinate_clauses += subordinate_count
        total_clauses += estimated_clauses

    avg_clause_depth = total_subordinate_clauses / len(sentences) if sentences else 0.0
    avg_words_per_clause = total_words / total_clauses if total_clauses > 0 else 0.0
    subordinate_clause_ratio = total_subordinate_clauses / total_clauses if total_clauses > 0 else 0.0

    return SyntacticComplexityStats(
        avg_clause_depth=round(avg_clause_depth, 2),
        avg_words_per_clause=round(avg_words_per_clause, 2),
        subordinate_clause_ratio=round(subordinate_clause_ratio, 3),
    )


def analyze_stylometry(text: str) -> StylometricAnalysis:
    """
    Perform complete stylometric analysis on text.

    Returns all five metric categories:
    - Sentence length distribution
    - Punctuation fingerprint
    - Vocabulary richness
    - Function word distribution
    - Syntactic complexity
    """
    return StylometricAnalysis(
        sentence_length=sentence_length_distribution(text),
        punctuation=punctuation_fingerprint(text),
        vocabulary=vocabulary_richness(text),
        function_words=function_word_distribution(text),
        syntactic=syntactic_complexity(text),
    )


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    if len(vec_a) != len(vec_b) or not vec_a:
        return 0.0

    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot_product / (norm_a * norm_b)


def gaussian_similarity(val_a: float, val_b: float, sigma: float = 1.0) -> float:
    """
    Calculate Gaussian similarity between two scalar values.

    Returns a value between 0 and 1, where 1 means identical values.
    Sigma controls how quickly similarity drops off with distance.
    """
    diff = val_a - val_b
    return math.exp(-(diff * diff) / (2 * sigma * sigma))


def compare_analyses(a: StylometricAnalysis, b: StylometricAnalysis) -> ComparisonResult:
    """
    Compare two stylometric analyses and return similarity score.

    Uses weighted combination of dimension similarities:
    - Function words: 35% (highest weight, most discriminative)
    - Sentence length: 20%
    - Punctuation: 15%
    - Vocabulary: 15%
    - Syntactic: 15%

    Returns overall similarity (0-1) and per-dimension breakdown.
    """
    # Sentence length similarity (Gaussian)
    sl_mean_sim = gaussian_similarity(a.sentence_length.mean, b.sentence_length.mean, sigma=5.0)
    sl_std_sim = gaussian_similarity(a.sentence_length.std_dev, b.sentence_length.std_dev, sigma=3.0)
    sentence_sim = (sl_mean_sim + sl_std_sim) / 2

    # Punctuation similarity (cosine)
    punct_a = [
        a.punctuation.period, a.punctuation.comma, a.punctuation.exclamation,
        a.punctuation.question, a.punctuation.hyphen, a.punctuation.em_dash,
    ]
    punct_b = [
        b.punctuation.period, b.punctuation.comma, b.punctuation.exclamation,
        b.punctuation.question, b.punctuation.hyphen, b.punctuation.em_dash,
    ]
    # Normalize by total to get rates
    total_a = max(1, a.punctuation.total)
    total_b = max(1, b.punctuation.total)
    punct_a_norm = [p / total_a for p in punct_a]
    punct_b_norm = [p / total_b for p in punct_b]
    punct_sim = (cosine_similarity(punct_a_norm, punct_b_norm) + 1) / 2  # Normalize to 0-1

    # Vocabulary similarity (Gaussian)
    vocab_ttr_sim = gaussian_similarity(a.vocabulary.type_token_ratio, b.vocabulary.type_token_ratio, sigma=0.1)
    vocab_hapax_sim = gaussian_similarity(a.vocabulary.hapax_ratio, b.vocabulary.hapax_ratio, sigma=0.1)
    vocab_sim = (vocab_ttr_sim + vocab_hapax_sim) / 2

    # Function word similarity (cosine)
    fw_a = [
        a.function_words.the, a.function_words.and_word, a.function_words.but,
        a.function_words.of, a.function_words.to, a.function_words.a,
        a.function_words.in_word, a.function_words.that, a.function_words.is_word,
        a.function_words.it,
    ]
    fw_b = [
        b.function_words.the, b.function_words.and_word, b.function_words.but,
        b.function_words.of, b.function_words.to, b.function_words.a,
        b.function_words.in_word, b.function_words.that, b.function_words.is_word,
        b.function_words.it,
    ]
    fw_sim = (cosine_similarity(fw_a, fw_b) + 1) / 2  # Normalize to 0-1

    # Syntactic similarity (Gaussian)
    syn_depth_sim = gaussian_similarity(a.syntactic.avg_clause_depth, b.syntactic.avg_clause_depth, sigma=0.5)
    syn_words_sim = gaussian_similarity(a.syntactic.avg_words_per_clause, b.syntactic.avg_words_per_clause, sigma=3.0)
    syntactic_sim = (syn_depth_sim + syn_words_sim) / 2

    # Weighted combination (matching TypeScript signature.ts weights)
    weights = {
        "sentence_length": 0.20,
        "punctuation": 0.15,
        "vocabulary": 0.15,
        "function_words": 0.35,
        "syntactic": 0.15,
    }

    dimension_scores = {
        "sentence_length": round(sentence_sim, 3),
        "punctuation": round(punct_sim, 3),
        "vocabulary": round(vocab_sim, 3),
        "function_words": round(fw_sim, 3),
        "syntactic": round(syntactic_sim, 3),
    }

    overall = (
        weights["sentence_length"] * sentence_sim +
        weights["punctuation"] * punct_sim +
        weights["vocabulary"] * vocab_sim +
        weights["function_words"] * fw_sim +
        weights["syntactic"] * syntactic_sim
    )

    return ComparisonResult(
        overall_similarity=round(overall, 3),
        dimension_scores=dimension_scores,
    )


def compare_texts(text_a: str, text_b: str) -> ComparisonResult:
    """
    Compare two texts stylometrically.

    Convenience function that analyzes both texts and compares them.
    """
    analysis_a = analyze_stylometry(text_a)
    analysis_b = analyze_stylometry(text_b)
    return compare_analyses(analysis_a, analysis_b)


def analysis_to_dict(analysis: StylometricAnalysis) -> dict:
    """
    Convert StylometricAnalysis to a dictionary for JSON serialization.
    """
    return {
        "sentence_length": {
            "mean": analysis.sentence_length.mean,
            "std_dev": analysis.sentence_length.std_dev,
            "min": analysis.sentence_length.min_length,
            "max": analysis.sentence_length.max_length,
            "count": analysis.sentence_length.count,
            "distribution": analysis.sentence_length.distribution,
        },
        "punctuation": {
            "period": analysis.punctuation.period,
            "comma": analysis.punctuation.comma,
            "exclamation": analysis.punctuation.exclamation,
            "question": analysis.punctuation.question,
            "hyphen": analysis.punctuation.hyphen,
            "em_dash": analysis.punctuation.em_dash,
            "ellipsis": analysis.punctuation.ellipsis,
            "semicolon": analysis.punctuation.semicolon,
            "colon": analysis.punctuation.colon,
            "total": analysis.punctuation.total,
        },
        "vocabulary": {
            "type_token_ratio": analysis.vocabulary.type_token_ratio,
            "hapax_legomena": analysis.vocabulary.hapax_legomena,
            "hapax_ratio": analysis.vocabulary.hapax_ratio,
            "total_words": analysis.vocabulary.total_words,
            "unique_words": analysis.vocabulary.unique_words,
        },
        "function_words": {
            "the": analysis.function_words.the,
            "and": analysis.function_words.and_word,
            "but": analysis.function_words.but,
            "of": analysis.function_words.of,
            "to": analysis.function_words.to,
            "a": analysis.function_words.a,
            "in": analysis.function_words.in_word,
            "that": analysis.function_words.that,
            "is": analysis.function_words.is_word,
            "it": analysis.function_words.it,
            "for": analysis.function_words.for_word,
            "as": analysis.function_words.as_word,
            "with": analysis.function_words.with_word,
            "was": analysis.function_words.was,
            "be": analysis.function_words.be,
            "by": analysis.function_words.by,
            "on": analysis.function_words.on,
            "not": analysis.function_words.not_word,
            "or": analysis.function_words.or_word,
            "are": analysis.function_words.are,
            "total": analysis.function_words.total,
        },
        "syntactic": {
            "avg_clause_depth": analysis.syntactic.avg_clause_depth,
            "avg_words_per_clause": analysis.syntactic.avg_words_per_clause,
            "subordinate_clause_ratio": analysis.syntactic.subordinate_clause_ratio,
        },
    }
