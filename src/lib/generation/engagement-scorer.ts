/**
 * Engagement Scorer
 *
 * Analyzes post content and predicts engagement based on X algorithm insights.
 * Used to score posts before publishing and provide optimization suggestions.
 */

export interface EngagementPrediction {
  predictedLikes: number; // 1-10 scale
  predictedReplies: number; // 1-10 scale
  predictedReposts: number; // 1-10 scale
  overallScore: number; // 1-10 scale
  suggestions: string[];
  hookDetected: boolean;
  hasQuestion: boolean;
  lengthOptimal: boolean;
}

// Hook patterns that work well on X
const HOOK_PATTERNS = [
  /^you('re| are) probably/i,
  /^unpopular opinion:?/i,
  /^i spent \d+/i,
  /^nobody talks about/i,
  /^the real reason/i,
  /^stop doing/i,
  /^most people/i,
  /^here's (the|a) secret/i,
  /^hot take:?/i,
  /^controversial:?/i,
  /^what if i told you/i,
  /^the truth (is|about)/i,
  /^why (you|most|nobody)/i,
  /^forget everything/i,
  /^\d+ (things|reasons|ways)/i,
  /^the \d+ (biggest|most)/i,
  /^i (just|finally)/i,
  /^after \d+ (years|months|weeks)/i,
];

// Quotable patterns that encourage reposts
const QUOTABLE_PATTERNS = [
  /the (secret|truth|key|trick) is/i,
  /\d+% of people/i,
  /in \d+ (years?|months?|weeks?)/i,
  /if you (want|need) to/i,
  /the difference between/i,
  /successful people/i,
  /the (one|only) thing/i,
  /never (underestimate|forget)/i,
  /always remember/i,
];

// Optimal length range based on X algorithm data
const OPTIMAL_LENGTH_MIN = 100;
const OPTIMAL_LENGTH_MAX = 250;

/**
 * Score a post for predicted engagement.
 */
export function scorePostEngagement(content: string): EngagementPrediction {
  let likeScore = 5;
  let replyScore = 5;
  let repostScore = 5;
  const suggestions: string[] = [];

  // Hook Detection - strong hooks boost likes and reposts
  const hasHook = HOOK_PATTERNS.some((p) => p.test(content));
  if (hasHook) {
    likeScore += 2;
    repostScore += 2;
  } else {
    suggestions.push(
      'Add a stronger hook at the beginning (e.g., "You\'re probably...", "The truth is...")'
    );
  }

  // Question Detection - questions boost replies
  const hasQuestion = content.includes('?');
  if (hasQuestion) {
    replyScore += 2;
  } else {
    suggestions.push('Consider adding a question to encourage replies');
  }

  // Length Scoring
  const length = content.length;
  let lengthOptimal = false;
  if (length >= OPTIMAL_LENGTH_MIN && length <= OPTIMAL_LENGTH_MAX) {
    likeScore += 1;
    lengthOptimal = true;
  } else if (length < 50) {
    likeScore -= 2;
    suggestions.push('Post is too short - add more substance (aim for 100-250 chars)');
  } else if (length > 280) {
    suggestions.push('Consider shortening for better engagement (optimal: 100-250 chars)');
  } else if (length < OPTIMAL_LENGTH_MIN) {
    suggestions.push(
      `Post could be longer - optimal is ${OPTIMAL_LENGTH_MIN}-${OPTIMAL_LENGTH_MAX} chars`
    );
  }

  // Hashtag Penalty - X algorithm doesn't boost hashtags anymore
  const hashtagCount = (content.match(/#\w+/g) ?? []).length;
  if (hashtagCount > 0) {
    likeScore -= hashtagCount;
    suggestions.push('Remove hashtags - they no longer boost reach on X');
  }

  // Link Penalty - links in main content reduce reach
  if (content.includes('http://') || content.includes('https://')) {
    likeScore -= 2;
    suggestions.push('Links reduce reach - consider putting link in reply instead');
  }

  // Quotability check - quotable content gets reposted
  const isQuotable = QUOTABLE_PATTERNS.some((p) => p.test(content));
  if (isQuotable) {
    repostScore += 2;
  }

  // Emotional triggers boost likes
  const emotionalPatterns = [
    /(!{2,})/,
    /(love|hate|amazing|terrible|incredible|worst|best)/i,
    /(changed my life|blew my mind|game.?changer)/i,
  ];
  const hasEmotionalTrigger = emotionalPatterns.some((p) => p.test(content));
  if (hasEmotionalTrigger) {
    likeScore += 1;
  }

  // Controversial content boosts replies
  const controversialPatterns = [
    /unpopular opinion/i,
    /hot take/i,
    /controversial/i,
    /disagree/i,
    /wrong about/i,
  ];
  const hasControversy = controversialPatterns.some((p) => p.test(content));
  if (hasControversy) {
    replyScore += 1;
  }

  // Actionable advice boosts reposts
  const actionablePatterns = [
    /here's how/i,
    /step (by step|\d+)/i,
    /do this instead/i,
    /try this/i,
    /pro tip/i,
  ];
  const hasActionable = actionablePatterns.some((p) => p.test(content));
  if (hasActionable) {
    repostScore += 1;
  }

  // Clamp scores to 1-10 range
  likeScore = Math.min(10, Math.max(1, Math.round(likeScore)));
  replyScore = Math.min(10, Math.max(1, Math.round(replyScore)));
  repostScore = Math.min(10, Math.max(1, Math.round(repostScore)));

  // Overall score: weighted average
  const overallScore = Math.min(
    10,
    Math.max(1, Math.round(likeScore * 0.4 + replyScore * 0.3 + repostScore * 0.3))
  );

  return {
    predictedLikes: likeScore,
    predictedReplies: replyScore,
    predictedReposts: repostScore,
    overallScore,
    suggestions: suggestions.slice(0, 3), // Limit to top 3 suggestions
    hookDetected: hasHook,
    hasQuestion,
    lengthOptimal,
  };
}

/**
 * Get engagement optimization tips for a specific target.
 */
export function getOptimizationTips(
  target: 'likes' | 'replies' | 'reposts' | 'balanced'
): string[] {
  const tips: Record<string, string[]> = {
    likes: [
      'Start with an emotional hook',
      'Use strong, relatable statements',
      'Keep it concise (100-250 chars)',
      'Add exclamation for emphasis',
      'Share personal experiences',
    ],
    replies: [
      'End with a question',
      'Share a slightly controversial take',
      'Ask for opinions or experiences',
      'Create a discussion prompt',
      'Challenge common assumptions',
    ],
    reposts: [
      'Share actionable advice',
      'Use quotable, memorable phrases',
      'Provide unique insights',
      'Create "I wish I said that" moments',
      'Include statistics or numbers',
    ],
    balanced: [
      'Start with a hook, end with a question',
      'Keep optimal length (100-250 chars)',
      'Mix insight with engagement prompt',
      'Be authentic and relatable',
      'No hashtags or links in main content',
    ],
  };

  return tips[target] ?? tips.balanced;
}

/**
 * Suggested hook starters based on content type.
 */
export const HOOK_STARTERS = [
  "You're probably still doing...",
  'Unpopular opinion:',
  'I spent X hours/days/weeks...',
  'Nobody talks about...',
  'The real reason...',
  'Stop doing X. Do Y instead.',
  'Most people think... but actually...',
  "Here's the secret:",
  'Hot take:',
  'Why you should...',
  'The truth about...',
  '5 things I learned...',
  'After X years of...',
  'What if I told you...',
] as const;
