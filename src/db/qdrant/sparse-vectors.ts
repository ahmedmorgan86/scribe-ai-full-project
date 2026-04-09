/**
 * Sparse vector generation using TF-IDF for Qdrant hybrid search.
 *
 * TF-IDF (Term Frequency-Inverse Document Frequency) creates sparse vectors
 * where indices correspond to vocabulary terms and values represent term importance.
 */

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface TfIdfConfig {
  minTermLength?: number;
  maxTermLength?: number;
  maxTerms?: number;
  stopWords?: Set<string>;
  lowercase?: boolean;
}

const DEFAULT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'you',
  'your',
  'i',
  'we',
  'they',
  'this',
  'but',
  'not',
  'have',
  'had',
  'do',
  'does',
  'did',
  'if',
  'so',
  'my',
  'can',
  'just',
  'me',
  'more',
  'also',
  'been',
  'would',
  'could',
  'should',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'all',
  'each',
  'no',
  'yes',
  'any',
  'only',
  'other',
  'than',
  'then',
  'there',
  'these',
  'those',
  'such',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'once',
  'here',
  'why',
  'about',
  'very',
  'too',
  'own',
  'same',
  'some',
  'most',
  'out',
  'up',
  'down',
  'off',
  'now',
  'get',
  'got',
  'going',
  'make',
  'made',
  'like',
  'dont',
  "don't",
  'im',
  "i'm",
  "it's",
  'its',
  "that's",
  'thats',
  "there's",
  'theres',
  "you're",
  'youre',
  "i've",
  'ive',
  "we're",
  'were',
  "they're",
  'theyre',
]);

const DEFAULT_CONFIG: Required<TfIdfConfig> = {
  minTermLength: 2,
  maxTermLength: 50,
  maxTerms: 100,
  stopWords: DEFAULT_STOP_WORDS,
  lowercase: true,
};

/**
 * Vocabulary manager for TF-IDF.
 * Maps terms to stable indices for sparse vector generation.
 */
export class TfIdfVocabulary {
  private termToIndex: Map<string, number> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;
  private config: Required<TfIdfConfig>;

  constructor(config: TfIdfConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Hash a term to a stable index using simple hash function.
   * This allows for consistent indexing without needing a pre-built vocabulary.
   */
  private hashTerm(term: string): number {
    let hash = 0;
    for (let i = 0; i < term.length; i++) {
      const char = term.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 1000000;
  }

  /**
   * Tokenize text into terms.
   */
  tokenize(text: string): string[] {
    const processed = this.config.lowercase ? text.toLowerCase() : text;
    const tokens = processed
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter((token) => {
        if (token.length < this.config.minTermLength) return false;
        if (token.length > this.config.maxTermLength) return false;
        if (this.config.stopWords.has(token)) return false;
        if (/^\d+$/.test(token)) return false;
        return true;
      });
    return tokens;
  }

  /**
   * Calculate term frequency for a document.
   */
  private calculateTf(terms: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    const maxFreq = Math.max(...tf.values(), 1);
    for (const [term, freq] of tf) {
      tf.set(term, 0.5 + (0.5 * freq) / maxFreq);
    }
    return tf;
  }

  /**
   * Update document frequency counts (for building IDF).
   */
  updateDocumentFrequency(text: string): void {
    const terms = this.tokenize(text);
    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      if (!this.termToIndex.has(term)) {
        this.termToIndex.set(term, this.hashTerm(term));
      }
    }
    this.totalDocuments++;
  }

  /**
   * Update document frequency from multiple documents.
   */
  updateDocumentFrequencyBatch(texts: string[]): void {
    for (const text of texts) {
      this.updateDocumentFrequency(text);
    }
  }

  /**
   * Calculate IDF for a term.
   */
  private calculateIdf(term: string): number {
    const df = this.documentFrequency.get(term) ?? 0;
    if (df === 0 || this.totalDocuments === 0) {
      return 1.0;
    }
    return Math.log((this.totalDocuments + 1) / (df + 1)) + 1;
  }

  /**
   * Generate sparse vector for a text using TF-IDF.
   */
  generateSparseVector(text: string): SparseVector {
    const terms = this.tokenize(text);
    if (terms.length === 0) {
      return { indices: [], values: [] };
    }

    const tf = this.calculateTf(terms);
    const tfidfScores: Array<{ index: number; value: number; term: string }> = [];

    for (const [term, tfValue] of tf) {
      const idf = this.calculateIdf(term);
      const tfidf = tfValue * idf;
      const index = this.termToIndex.get(term) ?? this.hashTerm(term);
      tfidfScores.push({ index, value: tfidf, term });
    }

    tfidfScores.sort((a, b) => b.value - a.value);
    const topTerms = tfidfScores.slice(0, this.config.maxTerms);

    topTerms.sort((a, b) => a.index - b.index);

    return {
      indices: topTerms.map((t) => t.index),
      values: topTerms.map((t) => t.value),
    };
  }

  /**
   * Get vocabulary statistics.
   */
  getStats(): { vocabularySize: number; totalDocuments: number } {
    return {
      vocabularySize: this.termToIndex.size,
      totalDocuments: this.totalDocuments,
    };
  }

  /**
   * Export vocabulary state for persistence.
   */
  exportState(): {
    termToIndex: Record<string, number>;
    documentFrequency: Record<string, number>;
    totalDocuments: number;
  } {
    return {
      termToIndex: Object.fromEntries(this.termToIndex),
      documentFrequency: Object.fromEntries(this.documentFrequency),
      totalDocuments: this.totalDocuments,
    };
  }

  /**
   * Import vocabulary state from persistence.
   */
  importState(state: {
    termToIndex: Record<string, number>;
    documentFrequency: Record<string, number>;
    totalDocuments: number;
  }): void {
    this.termToIndex = new Map(Object.entries(state.termToIndex));
    this.documentFrequency = new Map(Object.entries(state.documentFrequency));
    this.totalDocuments = state.totalDocuments;
  }

  /**
   * Reset vocabulary state.
   */
  reset(): void {
    this.termToIndex.clear();
    this.documentFrequency.clear();
    this.totalDocuments = 0;
  }
}

let defaultVocabulary: TfIdfVocabulary | null = null;

/**
 * Get or create the default vocabulary instance.
 */
export function getDefaultVocabulary(config?: TfIdfConfig): TfIdfVocabulary {
  if (!defaultVocabulary) {
    defaultVocabulary = new TfIdfVocabulary(config);
  }
  return defaultVocabulary;
}

/**
 * Reset the default vocabulary instance.
 */
export function resetDefaultVocabulary(): void {
  defaultVocabulary = null;
}

/**
 * Simple function to generate a sparse vector from text.
 * Uses the default vocabulary instance.
 */
export function textToSparseVector(text: string, config?: TfIdfConfig): SparseVector {
  const vocab = config ? new TfIdfVocabulary(config) : getDefaultVocabulary();
  return vocab.generateSparseVector(text);
}

/**
 * Generate sparse vectors for multiple texts.
 * First updates document frequencies, then generates vectors.
 */
export function textsToSparseVectors(texts: string[], config?: TfIdfConfig): SparseVector[] {
  const vocab = new TfIdfVocabulary(config);
  vocab.updateDocumentFrequencyBatch(texts);
  return texts.map((text) => vocab.generateSparseVector(text));
}

/**
 * Extract keywords from text (top terms by TF-IDF score).
 */
export function extractKeywords(
  text: string,
  maxKeywords: number = 10,
  config?: TfIdfConfig
): string[] {
  const vocab = new TfIdfVocabulary(config);
  const terms = vocab.tokenize(text);
  if (terms.length === 0) return [];

  const termCounts = new Map<string, number>();
  for (const term of terms) {
    termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  }

  const scored = Array.from(termCounts.entries()).map(([term, count]) => ({
    term,
    score: count / terms.length,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxKeywords).map((s) => s.term);
}
