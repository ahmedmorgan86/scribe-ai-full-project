/**
 * Humanizer Patterns - Detection for AI-generated writing markers
 *
 * Based on the 24 patterns from the Humanizer skill (https://github.com/blader/humanizer)
 * These patterns detect common AI writing tells that make content sound robotic.
 */

export type HumanizerPatternType =
  // Content Patterns (1-6)
  | 'significance_inflation'
  | 'notability_namedropping'
  | 'superficial_ing_analysis'
  | 'promotional_language'
  | 'vague_attributions'
  | 'formulaic_challenges'
  // Language Patterns (7-12)
  | 'ai_vocabulary'
  | 'copula_avoidance'
  | 'negative_parallelisms'
  | 'rule_of_three'
  | 'synonym_cycling'
  | 'false_ranges'
  // Style Patterns (13-18)
  | 'em_dash_overuse'
  | 'boldface_overuse'
  | 'inline_header_lists'
  | 'title_case_headings'
  | 'emoji_in_professional'
  | 'curly_quotes'
  // Communication Patterns (19-21)
  | 'chatbot_artifacts'
  | 'cutoff_disclaimers'
  | 'sycophantic_tone'
  // Filler and Hedging (22-24)
  | 'filler_phrases'
  | 'excessive_hedging'
  | 'generic_conclusions';

export interface HumanizerMatch {
  patternType: HumanizerPatternType;
  description: string;
  severity: 'low' | 'medium' | 'high';
  matches: string[];
  count: number;
  suggestion: string;
  rewrites?: RewriteSuggestion[];
}

export interface RewriteSuggestion {
  original: string;
  rewritten: string;
  explanation: string;
}

/**
 * Per-match detection result with rewrite suggestion
 * Used by HUM-002 transform function to apply rewrites
 */
export interface PatternDetectionResult {
  detected: boolean;
  original: string;
  suggestion: string;
  patternName: string;
}

export interface HumanizerCheckResult {
  hasIssues: boolean;
  patterns: HumanizerMatch[];
  totalScore: number;
}

interface PatternConfig {
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
  detect: (content: string) => string[];
  rewrite?: (match: string) => RewriteSuggestion;
}

// ============================================================================
// Pattern Detection Functions
// ============================================================================

/**
 * 1. Significance Inflation - Overstating importance with grandiose framing
 */
function detectSignificanceInflation(content: string): string[] {
  const patterns = [
    /\b(revolutionizing|transforming|reshaping|redefining)\s+the\s+\w+/gi,
    /\b(unprecedented|groundbreaking|paradigm-shifting|game-changing)\b/gi,
    /\b(fundamentally|dramatically|radically)\s+(chang|transform|alter)/gi,
    /\bforever\s+(chang|transform)/gi,
    /\bthe\s+future\s+of\s+\w+/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 2. Notability Name-Dropping - Vague media citations without specifics
 */
function detectNotabilityNamedropping(content: string): string[] {
  const patterns = [
    /\b(featured in|as seen in|covered by)\s+(major|leading|top)\s+(publications?|outlets?|media)/gi,
    /\b(recognized by|endorsed by|praised by)\s+(industry|thought)\s+leaders/gi,
    /\baccording to (experts?|analysts?|insiders?)\b/gi,
    /\b(widely|highly)\s+(regarded|acclaimed|praised)\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 3. Superficial -ing Analyses - Gerunds that add no substance
 */
function detectSuperficialIngAnalysis(content: string): string[] {
  const patterns = [
    /\b(showcasing|demonstrating|highlighting|illustrating)\s+(the|a|an)\s+(importance|value|need|power)/gi,
    /\b(exploring|examining|analyzing|investigating)\s+(the|a|an)\s+(various|different|multiple)/gi,
    /\b(leveraging|utilizing|harnessing|capitalizing\s+on)/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 4. Promotional Language - Flowery adjectives over facts
 */
function detectPromotionalLanguage(content: string): string[] {
  const patterns = [
    /\b(cutting-edge|state-of-the-art|world-class|best-in-class|top-tier)\b/gi,
    /\b(innovative|dynamic|robust|comprehensive|holistic)\b/gi,
    /\b(seamless|intuitive|elegant|powerful|stunning)\b/gi,
    /\b(unparalleled|unmatched|exceptional|extraordinary)\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 5. Vague Attributions - "Experts believe" without sources
 */
function detectVagueAttributions(content: string): string[] {
  const patterns = [
    /\b(experts?|analysts?|researchers?|scientists?|specialists?)\s+(believe|say|suggest|indicate|argue)/gi,
    /\b(studies|research|data)\s+(show|suggest|indicate|prove|reveal)/gi,
    /\b(it is|it's)\s+(widely|commonly|generally)\s+(known|believed|accepted|thought)/gi,
    /\bsome\s+(people|experts?|researchers?)\s+(think|believe|say)/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 6. Formulaic Challenges - Generic obstacle framing
 */
function detectFormulaicChallenges(content: string): string[] {
  const patterns = [
    /\bdespite\s+(the\s+)?(challenges?|obstacles?|difficulties?|setbacks?)/gi,
    /\bovercoming\s+(the\s+)?(challenges?|obstacles?|barriers?)/gi,
    /\b(faces?|facing|faced)\s+(significant|major|key|critical)\s+(challenges?|hurdles?)/gi,
    /\b(in the face of|amidst|amid)\s+(adversity|challenges?|difficulties?)/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 7. AI Vocabulary - Overused AI-typical words
 */
function detectAiVocabulary(content: string): string[] {
  const patterns = [
    /\b(additionally|furthermore|moreover|consequently|subsequently)\b/gi,
    /\btestament\s+to\b/gi,
    /\b(landscape|ecosystem|paradigm|synergy)\b/gi,
    /\b(showcasing|leveraging|spearheading|streamlining)\b/gi,
    /\b(delve|delves|delving|delved)\b/gi,
    /\b(embark|embarks|embarking|embarked)\b/gi,
    /\b(navigate|navigates|navigating|navigated)\s+(the\s+)?(complex|challenging|evolving)/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 8. Copula Avoidance - Avoiding "is/has" with complex phrases
 */
function detectCopulaAvoidance(content: string): string[] {
  const patterns = [
    /\b(serves as|acts as|functions as|stands as)\b/gi,
    /\b(features|boasts|offers|provides)\s+(a|an|the)\s+\w+\s+(array|range|variety|selection)/gi,
    /\b(represents|embodies|exemplifies|epitomizes)\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 9. Negative Parallelisms - "It's not just X, it's Y" constructions
 */
function detectNegativeParallelisms(content: string): string[] {
  const patterns = [
    /\b(it's|it is)\s+not\s+(just|only|merely|simply)\s+\w+[,;]\s+(it's|it is)\s+\w+/gi,
    /\bnot\s+(just|only|merely)\s+about\s+\w+[,;]\s+(but|it's)\s+(also\s+)?about/gi,
    /\bmore\s+than\s+(just|merely)\s+(a|an)\s+\w+/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 10. Rule of Three - Forced triplets
 */
function detectRuleOfThree(content: string): string[] {
  const matches: string[] = [];
  // Pattern: word, word, and word
  const tripletPattern = /\b(\w+),\s+(\w+),?\s+and\s+(\w+)\b/gi;
  let match;
  while ((match = tripletPattern.exec(content)) !== null) {
    // Check if all three words are similar length/type (suggests forced triplet)
    const [, w1, w2, w3] = match;
    if (w1 && w2 && w3) {
      const lengths = [w1.length, w2.length, w3.length];
      const avgLen = lengths.reduce((a, b) => a + b, 0) / 3;
      const variance = lengths.reduce((acc, l) => acc + Math.abs(l - avgLen), 0) / 3;
      // Very similar lengths suggest forced triplet
      if (variance < 2) {
        matches.push(match[0]);
      }
    }
  }
  return matches;
}

/**
 * 11. Synonym Cycling - Using different words for same concept
 */
function detectSynonymCycling(content: string): string[] {
  const synonymSets = [
    ['important', 'crucial', 'vital', 'essential', 'critical', 'key'],
    ['big', 'large', 'significant', 'substantial', 'considerable', 'major'],
    ['show', 'demonstrate', 'illustrate', 'exhibit', 'display', 'reveal'],
    ['help', 'assist', 'aid', 'support', 'facilitate', 'enable'],
    ['make', 'create', 'develop', 'build', 'construct', 'produce'],
  ];

  const matches: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const synonyms of synonymSets) {
    const found = synonyms.filter((word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(lowerContent);
    });
    // If 3+ synonyms from same set are used, flag it
    if (found.length >= 3) {
      matches.push(`Synonym cycling: ${found.join(', ')}`);
    }
  }
  return matches;
}

/**
 * 12. False Ranges - "From X to Y" lists
 */
function detectFalseRanges(content: string): string[] {
  const patterns = [
    /\bfrom\s+\w+\s+to\s+\w+\b/gi,
    /\b(ranging|range)\s+from\s+/gi,
    /\beverything\s+from\s+\w+\s+to\s+\w+\b/gi,
    /\bwhether\s+.+\s+or\s+.+\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 13. Em Dash Overuse - Too many dashes
 */
function detectEmDashOveruse(content: string): string[] {
  const emDashPattern = /—|--/g;
  const matches: string[] = [];
  let match;
  while ((match = emDashPattern.exec(content)) !== null) {
    const start = Math.max(0, match.index - 20);
    const end = Math.min(content.length, match.index + 22);
    matches.push(content.slice(start, end).trim());
  }
  // Only flag if 3+ dashes
  return matches.length >= 3 ? matches : [];
}

/**
 * 14. Boldface Overuse - Excessive **bold** formatting
 */
function detectBoldfaceOveruse(content: string): string[] {
  const patterns = [/\*\*[^*]+\*\*/g, /<b>[^<]+<\/b>/gi, /<strong>[^<]+<\/strong>/gi];
  const matches = matchPatterns(content, patterns);
  // Only flag if 3+ bold sections
  return matches.length >= 3 ? matches : [];
}

/**
 * 15. Inline-Header Lists - **Label:** description format
 */
function detectInlineHeaderLists(content: string): string[] {
  const patterns = [/\*\*[^*:]+:\*\*\s+/g, /^[-•]\s*\*\*[^*]+\*\*:/gm];
  return matchPatterns(content, patterns);
}

/**
 * 16. Title Case Headings - Excessive capitalization
 */
function detectTitleCaseHeadings(content: string): string[] {
  const patterns = [
    /^#+\s+([A-Z][a-z]+\s+){3,}/gm, // Markdown headings with title case
    /^([A-Z][a-z]+\s+){4,}$/gm, // Lines that are all title case
  ];
  return matchPatterns(content, patterns);
}

/**
 * 17. Emojis in Professional Text
 */
function detectEmojiInProfessional(content: string): string[] {
  const emojiPattern = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const matches: string[] = [];
  let match;
  while ((match = emojiPattern.exec(content)) !== null) {
    matches.push(match[0]);
  }
  return matches;
}

/**
 * 18. Curly Quotes - Fancy quote characters
 */
function detectCurlyQuotes(content: string): string[] {
  const patterns = [/[""'']/g];
  return matchPatterns(content, patterns);
}

/**
 * 19. Chatbot Artifacts - Closing phrases like "I hope this helps"
 */
function detectChatbotArtifacts(content: string): string[] {
  const patterns = [
    /\bi hope this helps\b/gi,
    /\blet me know if you (have|need|want)\b/gi,
    /\bfeel free to (ask|reach out|contact)\b/gi,
    /\bif you have any (questions?|concerns?)\b/gi,
    /\bhappy to help\b/gi,
    /\bI'd be happy to\b/gi,
    /\bdon't hesitate to\b/gi,
    /\bplease let me know\b/gi,
    /\bI'm here to help\b/gi,
    /\bIs there anything else\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 20. Cutoff Disclaimers - Hedges about limited knowledge
 */
function detectCutoffDisclaimers(content: string): string[] {
  const patterns = [
    /\b(as of|up to)\s+(my|this)\s+(knowledge|training|data)/gi,
    /\bmy (knowledge|training|information)\s+(cutoff|is limited)/gi,
    /\bi don't have (access to|information about)\s+(real-time|current|recent)/gi,
    /\b(i cannot|i can't)\s+(access|browse|search)\s+(the internet|web|online)/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 21. Sycophantic Tone - Excessive enthusiasm and agreement
 */
function detectSycophancy(content: string): string[] {
  const patterns = [
    /\b(great|excellent|wonderful|fantastic|amazing)\s+(question|point|observation|insight)/gi,
    /\bthat's (a )?(great|excellent|wonderful|fantastic)\s+(question|point|idea)/gi,
    /\babsolutely(!|,|\s)/gi,
    /\bI (completely|totally|absolutely|fully) agree\b/gi,
    /\byou('re| are) (absolutely|completely|totally) right\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 22. Filler Phrases - Wordy constructions
 */
function detectFillerPhrases(content: string): string[] {
  const patterns = [
    /\bin order to\b/gi,
    /\bdue to the fact that\b/gi,
    /\bat the end of the day\b/gi,
    /\bit (is|should be) (important to )?noted that\b/gi,
    /\bit goes without saying\b/gi,
    /\bin (today's|this) day and age\b/gi,
    /\bfor all intents and purposes\b/gi,
    /\bin terms of\b/gi,
    /\bwith (regard|respect) to\b/gi,
    /\bthe fact (that|of the matter)\b/gi,
  ];
  return matchPatterns(content, patterns);
}

/**
 * 23. Excessive Hedging - Too many qualifiers
 */
function detectExcessiveHedging(content: string): string[] {
  const patterns = [
    /\b(could|might|may)\s+(potentially|possibly|perhaps)\b/gi,
    /\b(somewhat|rather|fairly|quite)\s+(important|significant|useful)\b/gi,
    /\b(it seems|it appears|it looks like)\s+(that\s+)?/gi,
    /\b(perhaps|maybe|possibly|potentially)\b/gi,
  ];
  const matches = matchPatterns(content, patterns);
  // Only flag if multiple hedges
  return matches.length >= 2 ? matches : [];
}

/**
 * 24. Generic Conclusions - Vague endings
 */
function detectGenericConclusions(content: string): string[] {
  const patterns = [
    /\b(only time will tell|the future (is|looks) (bright|promising))\b/gi,
    /\b(it remains to be seen|time will reveal)\b/gi,
    /\bstay tuned for (more|updates|further)\b/gi,
    /\bin conclusion,?\s+(it is|we can see|this shows)\b/gi,
    /\b(in summary|to sum up|to conclude),?\s+/gi,
    /\bexciting times (ahead|lie ahead|are ahead)\b/gi,
    /\bthe possibilities are (endless|limitless)\b/gi,
  ];
  return matchPatterns(content, patterns);
}

// ============================================================================
// Pattern Configuration
// ============================================================================

const PATTERN_CONFIGS: Record<HumanizerPatternType, PatternConfig> = {
  // Content Patterns (1-6)
  significance_inflation: {
    name: 'Significance Inflation',
    description: 'Overstating importance with grandiose framing',
    severity: 'medium',
    suggestion: 'Replace grandiose framing with concrete facts',
    detect: detectSignificanceInflation,
  },
  notability_namedropping: {
    name: 'Notability Name-Dropping',
    description: 'Vague media citations without specifics',
    severity: 'medium',
    suggestion: 'Use specific quotes or references instead of vague citations',
    detect: detectNotabilityNamedropping,
  },
  superficial_ing_analysis: {
    name: 'Superficial -ing Analysis',
    description: 'Gerunds lacking substance',
    severity: 'low',
    suggestion: 'Expand with actual sources or remove descriptive gerunds',
    detect: detectSuperficialIngAnalysis,
  },
  promotional_language: {
    name: 'Promotional Language',
    description: 'Flowery adjectives over facts',
    severity: 'medium',
    suggestion: 'Use direct, factual descriptions instead of marketing speak',
    detect: detectPromotionalLanguage,
  },
  vague_attributions: {
    name: 'Vague Attributions',
    description: '"Experts believe" without sources',
    severity: 'high',
    suggestion: 'Replace with cited research including dates and sources',
    detect: detectVagueAttributions,
  },
  formulaic_challenges: {
    name: 'Formulaic Challenges',
    description: 'Generic obstacle framing',
    severity: 'low',
    suggestion: 'Provide specific obstacles rather than generic "despite challenges"',
    detect: detectFormulaicChallenges,
  },

  // Language Patterns (7-12)
  ai_vocabulary: {
    name: 'AI Vocabulary',
    description: 'Overused AI-typical words',
    severity: 'high',
    suggestion: 'Use simpler alternatives instead of AI-typical vocabulary',
    detect: detectAiVocabulary,
  },
  copula_avoidance: {
    name: 'Copula Avoidance',
    description: 'Avoiding "is/has" with complex phrases',
    severity: 'low',
    suggestion: 'Replace "serves as", "boasts" with direct "is" or "has"',
    detect: detectCopulaAvoidance,
  },
  negative_parallelisms: {
    name: 'Negative Parallelisms',
    description: '"It\'s not just X, it\'s Y" constructions',
    severity: 'medium',
    suggestion: 'State claims directly without negative parallel structure',
    detect: detectNegativeParallelisms,
  },
  rule_of_three: {
    name: 'Rule of Three',
    description: 'Forced triplets',
    severity: 'low',
    suggestion: 'Use naturally appropriate list lengths rather than forced triplets',
    detect: detectRuleOfThree,
  },
  synonym_cycling: {
    name: 'Synonym Cycling',
    description: 'Using different words for same concept',
    severity: 'medium',
    suggestion: 'Repeat the clearest term rather than cycling through synonyms',
    detect: detectSynonymCycling,
  },
  false_ranges: {
    name: 'False Ranges',
    description: '"From X to Y" lists',
    severity: 'low',
    suggestion: 'List topics directly instead of "from X to Y" formatting',
    detect: detectFalseRanges,
  },

  // Style Patterns (13-18)
  em_dash_overuse: {
    name: 'Em Dash Overuse',
    description: 'Too many dashes',
    severity: 'low',
    suggestion: 'Replace multiple dashes with commas or periods',
    detect: detectEmDashOveruse,
  },
  boldface_overuse: {
    name: 'Boldface Overuse',
    description: 'Excessive bold formatting',
    severity: 'low',
    suggestion: 'Remove unnecessary bolding; use plain text',
    detect: detectBoldfaceOveruse,
  },
  inline_header_lists: {
    name: 'Inline-Header Lists',
    description: '"**Label:** description" format',
    severity: 'low',
    suggestion: 'Convert "**Label:** description" formats to prose',
    detect: detectInlineHeaderLists,
  },
  title_case_headings: {
    name: 'Title Case Headings',
    description: 'Excessive capitalization',
    severity: 'low',
    suggestion: 'Use standard capitalization instead of excessive caps',
    detect: detectTitleCaseHeadings,
  },
  emoji_in_professional: {
    name: 'Emojis in Professional Text',
    description: 'Decorative emojis in serious content',
    severity: 'medium',
    suggestion: 'Remove all decorative emojis',
    detect: detectEmojiInProfessional,
  },
  curly_quotes: {
    name: 'Curly Quotes',
    description: 'Fancy quote characters',
    severity: 'low',
    suggestion: 'Standardize to straight quotes',
    detect: detectCurlyQuotes,
  },

  // Communication Patterns (19-21)
  chatbot_artifacts: {
    name: 'Chatbot Artifacts',
    description: 'Phrases like "I hope this helps"',
    severity: 'high',
    suggestion: 'Delete closing phrases typical of chatbots',
    detect: detectChatbotArtifacts,
  },
  cutoff_disclaimers: {
    name: 'Cutoff Disclaimers',
    description: 'Hedges about limited knowledge',
    severity: 'high',
    suggestion: 'Remove hedges about limited sources; find citations or delete',
    detect: detectCutoffDisclaimers,
  },
  sycophantic_tone: {
    name: 'Sycophantic Tone',
    description: 'Excessive enthusiasm and agreement',
    severity: 'medium',
    suggestion: 'Eliminate excessive enthusiasm; respond objectively',
    detect: detectSycophancy,
  },

  // Filler and Hedging (22-24)
  filler_phrases: {
    name: 'Filler Phrases',
    description: 'Wordy constructions',
    severity: 'medium',
    suggestion: 'Condense: "In order to" → "To"; "Due to the fact that" → "Because"',
    detect: detectFillerPhrases,
  },
  excessive_hedging: {
    name: 'Excessive Hedging',
    description: 'Too many qualifiers',
    severity: 'medium',
    suggestion: 'Replace "could potentially possibly" with single qualifier like "may"',
    detect: detectExcessiveHedging,
  },
  generic_conclusions: {
    name: 'Generic Conclusions',
    description: 'Vague endings',
    severity: 'medium',
    suggestion: 'Replace vague outlooks with specific actions or documented facts',
    detect: detectGenericConclusions,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function matchPatterns(content: string, patterns: RegExp[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    const cloned = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      matches.push(match[0]);
      if (!cloned.global) break;
    }
  }
  return matches;
}

// ============================================================================
// Rewrite Suggestions
// ============================================================================

/**
 * Generate a specific rewrite suggestion for a matched pattern
 */
function getRewriteSuggestion(patternType: HumanizerPatternType, original: string): string {
  const lower = original.toLowerCase();

  switch (patternType) {
    case 'significance_inflation':
      if (/revolutionizing|transforming|reshaping/i.test(original)) {
        return original.replace(/revolutionizing|transforming|reshaping/gi, 'changing');
      }
      if (/unprecedented|groundbreaking|paradigm-shifting/i.test(original)) {
        return '[remove or replace with specific fact]';
      }
      return '[state the specific change]';

    case 'ai_vocabulary':
      if (/additionally/i.test(lower)) return original.replace(/additionally/gi, 'also');
      if (/furthermore/i.test(lower)) return original.replace(/furthermore/gi, 'also');
      if (/moreover/i.test(lower)) return original.replace(/moreover/gi, 'also');
      if (/consequently/i.test(lower)) return original.replace(/consequently/gi, 'so');
      if (/subsequently/i.test(lower)) return original.replace(/subsequently/gi, 'then');
      if (/testament to/i.test(lower)) return original.replace(/testament to/gi, 'shows');
      if (/landscape/i.test(lower)) return original.replace(/landscape/gi, 'field');
      if (/ecosystem/i.test(lower)) return original.replace(/ecosystem/gi, 'system');
      if (/paradigm/i.test(lower)) return original.replace(/paradigm/gi, 'approach');
      if (/synergy/i.test(lower)) return original.replace(/synergy/gi, 'collaboration');
      if (/delve/i.test(lower)) return original.replace(/delv(e|es|ing|ed)/gi, 'explore');
      if (/embark/i.test(lower)) return original.replace(/embark(s|ing|ed)?/gi, 'start');
      if (/leveraging/i.test(lower)) return original.replace(/leveraging/gi, 'using');
      if (/showcasing/i.test(lower)) return original.replace(/showcasing/gi, 'showing');
      if (/spearheading/i.test(lower)) return original.replace(/spearheading/gi, 'leading');
      if (/streamlining/i.test(lower)) return original.replace(/streamlining/gi, 'simplifying');
      if (/navigate/i.test(lower)) return original.replace(/navigat(e|es|ing|ed)/gi, 'handle');
      return '[use simpler word]';

    case 'filler_phrases':
      if (/in order to/i.test(lower)) return original.replace(/in order to/gi, 'to');
      if (/due to the fact that/i.test(lower))
        return original.replace(/due to the fact that/gi, 'because');
      if (/at the end of the day/i.test(lower))
        return original.replace(/at the end of the day/gi, 'ultimately');
      if (/it (is|should be) (important to )?noted that/i.test(lower))
        return '[remove, state directly]';
      if (/it goes without saying/i.test(lower)) return '[remove]';
      if (/in (today's|this) day and age/i.test(lower))
        return original.replace(/in (today's|this) day and age/gi, 'now');
      if (/for all intents and purposes/i.test(lower))
        return original.replace(/for all intents and purposes/gi, 'essentially');
      if (/in terms of/i.test(lower)) return original.replace(/in terms of/gi, 'regarding');
      if (/with (regard|respect) to/i.test(lower))
        return original.replace(/with (regard|respect) to/gi, 'about');
      return '[remove or simplify]';

    case 'chatbot_artifacts':
      return '[remove]';

    case 'cutoff_disclaimers':
      return '[remove]';

    case 'sycophantic_tone':
      if (/great question/i.test(lower)) return '[remove]';
      if (/excellent point/i.test(lower)) return '[remove]';
      if (/absolutely/i.test(lower)) return original.replace(/absolutely/gi, 'yes');
      if (/I (completely|totally|absolutely|fully) agree/i.test(lower)) return 'I agree';
      return '[remove or tone down]';

    case 'excessive_hedging':
      if (/could potentially/i.test(lower)) return original.replace(/could potentially/gi, 'may');
      if (/might possibly/i.test(lower)) return original.replace(/might possibly/gi, 'might');
      if (/perhaps maybe/i.test(lower)) return original.replace(/perhaps maybe/gi, 'perhaps');
      return '[use single qualifier]';

    case 'copula_avoidance':
      if (/serves as/i.test(lower)) return original.replace(/serves as/gi, 'is');
      if (/acts as/i.test(lower)) return original.replace(/acts as/gi, 'is');
      if (/functions as/i.test(lower)) return original.replace(/functions as/gi, 'is');
      if (/stands as/i.test(lower)) return original.replace(/stands as/gi, 'is');
      if (/boasts/i.test(lower)) return original.replace(/boasts/gi, 'has');
      if (/features/i.test(lower)) return original.replace(/features/gi, 'has');
      if (/represents/i.test(lower)) return original.replace(/represents/gi, 'is');
      if (/embodies/i.test(lower)) return original.replace(/embodies/gi, 'is');
      if (/exemplifies/i.test(lower)) return original.replace(/exemplifies/gi, 'shows');
      if (/epitomizes/i.test(lower)) return original.replace(/epitomizes/gi, 'is');
      return '[use "is" or "has"]';

    case 'promotional_language':
      if (/cutting-edge/i.test(lower)) return original.replace(/cutting-edge/gi, 'new');
      if (/state-of-the-art/i.test(lower)) return original.replace(/state-of-the-art/gi, 'modern');
      if (/world-class/i.test(lower)) return original.replace(/world-class/gi, 'good');
      if (/best-in-class/i.test(lower)) return original.replace(/best-in-class/gi, 'leading');
      if (/innovative/i.test(lower)) return original.replace(/innovative/gi, 'new');
      if (/dynamic/i.test(lower)) return original.replace(/dynamic/gi, 'active');
      if (/robust/i.test(lower)) return original.replace(/robust/gi, 'strong');
      if (/comprehensive/i.test(lower)) return original.replace(/comprehensive/gi, 'complete');
      if (/holistic/i.test(lower)) return original.replace(/holistic/gi, 'whole');
      if (/seamless/i.test(lower)) return original.replace(/seamless/gi, 'smooth');
      if (/intuitive/i.test(lower)) return original.replace(/intuitive/gi, 'easy');
      if (/elegant/i.test(lower)) return original.replace(/elegant/gi, 'simple');
      if (/powerful/i.test(lower)) return original.replace(/powerful/gi, 'strong');
      if (/stunning/i.test(lower)) return original.replace(/stunning/gi, 'impressive');
      return '[use factual description]';

    case 'vague_attributions':
      return '[cite specific source with date]';

    case 'generic_conclusions':
      return '[state specific next step or fact]';

    case 'negative_parallelisms':
      return '[state claim directly]';

    case 'curly_quotes':
      return original.replace(/[""]/g, '"').replace(/['']/g, "'");

    case 'emoji_in_professional':
      return '[remove emoji]';

    case 'em_dash_overuse':
      return original.replace(/—|--/g, ',');

    case 'boldface_overuse':
      return original.replace(/\*\*([^*]+)\*\*/g, '$1');

    case 'inline_header_lists':
      return '[convert to prose]';

    default:
      return PATTERN_CONFIGS[patternType]?.suggestion ?? '[revise]';
  }
}

/**
 * Detect a specific pattern and return detailed results with rewrite suggestions
 */
export function detectPatternWithRewrite(
  content: string,
  patternType: HumanizerPatternType
): PatternDetectionResult[] {
  const config = PATTERN_CONFIGS[patternType];
  const matches = config.detect(content);

  return matches.map((original) => ({
    detected: true,
    original,
    suggestion: getRewriteSuggestion(patternType, original),
    patternName: config.name,
  }));
}

/**
 * Detect all patterns and return detailed results with rewrite suggestions
 */
export function detectAllPatternsWithRewrites(content: string): PatternDetectionResult[] {
  const results: PatternDetectionResult[] = [];

  for (const patternType of Object.keys(PATTERN_CONFIGS) as HumanizerPatternType[]) {
    results.push(...detectPatternWithRewrite(content, patternType));
  }

  return results;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Check content for all 24 humanizer patterns
 */
export function checkHumanizerPatterns(content: string): HumanizerCheckResult {
  const patterns: HumanizerMatch[] = [];
  let totalScore = 0;

  for (const [patternType, config] of Object.entries(PATTERN_CONFIGS)) {
    const matches = config.detect(content);
    if (matches.length > 0) {
      const severityScore = config.severity === 'high' ? 30 : config.severity === 'medium' ? 15 : 5;
      totalScore += severityScore * Math.min(matches.length, 3); // Cap at 3 matches per pattern

      patterns.push({
        patternType: patternType as HumanizerPatternType,
        description: config.description,
        severity: config.severity,
        matches,
        count: matches.length,
        suggestion: config.suggestion,
      });
    }
  }

  return {
    hasIssues: patterns.length > 0,
    patterns,
    totalScore: Math.min(100, totalScore),
  };
}

/**
 * Check for a specific humanizer pattern
 */
export function checkPattern(
  content: string,
  patternType: HumanizerPatternType
): HumanizerMatch | null {
  const config = PATTERN_CONFIGS[patternType];
  const matches = config.detect(content);
  if (matches.length === 0) return null;

  return {
    patternType,
    description: config.description,
    severity: config.severity,
    matches,
    count: matches.length,
    suggestion: config.suggestion,
  };
}

/**
 * Get human-readable name for a pattern type
 */
export function getPatternName(patternType: HumanizerPatternType): string {
  return PATTERN_CONFIGS[patternType]?.name ?? patternType;
}

/**
 * Get all pattern types
 */
export function getAllPatternTypes(): HumanizerPatternType[] {
  return Object.keys(PATTERN_CONFIGS) as HumanizerPatternType[];
}

/**
 * Calculate humanizer score (0-100, higher = more AI-sounding)
 */
export function getHumanizerScore(result: HumanizerCheckResult): number {
  return result.totalScore;
}

/**
 * Check if content has high AI-sounding score
 */
export function hasHighHumanizerScore(
  result: HumanizerCheckResult,
  threshold: number = 50
): boolean {
  return result.totalScore >= threshold;
}

/**
 * Format humanizer result for display
 */
export function formatHumanizerResult(result: HumanizerCheckResult): string {
  if (!result.hasIssues) {
    return 'No AI-sounding patterns detected.';
  }

  const lines = [`AI-sounding patterns detected (score: ${result.totalScore}/100):`, ''];

  const byPriority = [...result.patterns].sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  for (const pattern of byPriority) {
    const icon = pattern.severity === 'high' ? '!' : pattern.severity === 'medium' ? '~' : '.';
    lines.push(
      `  ${icon} [${pattern.severity.toUpperCase()}] ${getPatternName(pattern.patternType)}`
    );
    lines.push(`    ${pattern.description}`);
    lines.push(`    Matches: ${pattern.count}`);
    if (pattern.matches.length <= 3) {
      lines.push(`    Examples: ${pattern.matches.map((m) => `"${m}"`).join(', ')}`);
    } else {
      const preview = pattern.matches
        .slice(0, 3)
        .map((m) => `"${m}"`)
        .join(', ');
      lines.push(`    Examples: ${preview}... (+${pattern.matches.length - 3} more)`);
    }
    lines.push(`    Suggestion: ${pattern.suggestion}`);
    lines.push('');
  }

  return lines.join('\n');
}
