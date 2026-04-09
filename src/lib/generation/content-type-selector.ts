import type { Source, PostType } from '@/types';

export interface ContentTypeSignals {
  length: number;
  hasMultipleParagraphs: boolean;
  isReplyContext: boolean;
  isQuotable: boolean;
  hasQuestion: boolean;
  hasTechnicalDepth: boolean;
  hasDiscovery: boolean;
  hasControversial: boolean;
  engagementLevel: 'low' | 'medium' | 'high';
}

export interface ContentTypeScore {
  type: PostType;
  score: number;
  reasons: string[];
}

export interface ContentTypeSelection {
  recommended: PostType;
  scores: ContentTypeScore[];
  signals: ContentTypeSignals;
}

const THREAD_INDICATORS = [
  'step by step',
  "here's how",
  'breakdown',
  'lessons',
  'things i learned',
  'tips',
  'mistakes',
  'principles',
  'framework',
  'guide',
];

const QUOTE_INDICATORS = [
  'this is wrong',
  'disagree',
  'counterpoint',
  'hot take',
  'unpopular opinion',
  'adding to this',
  'building on',
  'related',
  'reminds me',
  'exactly',
];

const REPLY_INDICATORS = [
  '@',
  'your point',
  'you mentioned',
  'in response',
  'following up',
  'question for you',
  'what about',
];

const CONTROVERSIAL_INDICATORS = [
  'controversial',
  'unpopular',
  'disagree',
  'wrong',
  'myth',
  'overrated',
  'underrated',
  'hot take',
  'actually',
  'the truth is',
];

const DISCOVERY_INDICATORS = [
  'found',
  'discovered',
  'stumbled',
  'hidden gem',
  'underrated',
  'game changer',
  'life saver',
  'github',
  'repo',
  'tool',
  'library',
];

function extractSignals(source: Source): ContentTypeSignals {
  const content = source.content;
  const contentLower = content.toLowerCase();
  const length = content.length;

  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const hasMultipleParagraphs = paragraphs.length >= 2;

  const hasQuestion = /\?/.test(content);

  const technicalTerms = [
    'api',
    'code',
    'function',
    'bug',
    'deploy',
    'database',
    'server',
    'algorithm',
    'architecture',
    'performance',
    'latency',
    'cache',
    'async',
    'sync',
    'typescript',
    'javascript',
    'python',
    'react',
    'node',
  ];
  const technicalCount = technicalTerms.filter((term) => contentLower.includes(term)).length;
  const hasTechnicalDepth = technicalCount >= 2;

  const isReplyContext =
    REPLY_INDICATORS.some((ind) => contentLower.includes(ind.toLowerCase())) ||
    source.sourceType === 'like';

  const isQuotable =
    QUOTE_INDICATORS.some((ind) => contentLower.includes(ind.toLowerCase())) ||
    (source.metadata.likeCount !== undefined && source.metadata.likeCount > 100);

  const hasDiscovery = DISCOVERY_INDICATORS.some((ind) => contentLower.includes(ind.toLowerCase()));

  const hasControversial = CONTROVERSIAL_INDICATORS.some((ind) =>
    contentLower.includes(ind.toLowerCase())
  );

  let engagementLevel: 'low' | 'medium' | 'high' = 'low';
  const likeCount = source.metadata.likeCount ?? 0;
  const retweetCount = source.metadata.retweetCount ?? 0;
  const totalEngagement = likeCount + retweetCount * 2;

  if (totalEngagement > 500) {
    engagementLevel = 'high';
  } else if (totalEngagement > 50) {
    engagementLevel = 'medium';
  }

  return {
    length,
    hasMultipleParagraphs,
    isReplyContext,
    isQuotable,
    hasQuestion,
    hasTechnicalDepth,
    hasDiscovery,
    hasControversial,
    engagementLevel,
  };
}

function scoreThread(signals: ContentTypeSignals, contentLower: string): ContentTypeScore {
  let score = 0;
  const reasons: string[] = [];

  if (signals.length > 500) {
    score += 30;
    reasons.push('Long content suitable for breakdown');
  }

  if (signals.hasMultipleParagraphs) {
    score += 20;
    reasons.push('Multiple paragraphs indicate structure');
  }

  if (signals.hasTechnicalDepth) {
    score += 15;
    reasons.push('Technical depth benefits from thread format');
  }

  const threadMatches = THREAD_INDICATORS.filter((ind) => contentLower.includes(ind));
  if (threadMatches.length > 0) {
    score += 25;
    reasons.push(`Thread indicators: ${threadMatches.slice(0, 2).join(', ')}`);
  }

  if (signals.engagementLevel === 'high') {
    score += 10;
    reasons.push('High engagement source warrants deeper coverage');
  }

  return { type: 'thread', score, reasons };
}

function scoreSingle(signals: ContentTypeSignals, contentLower: string): ContentTypeScore {
  let score = 40;
  const reasons: string[] = ['Default format for concise insights'];

  if (signals.length <= 280) {
    score += 30;
    reasons.push('Content fits single tweet length');
  } else if (signals.length <= 500) {
    score += 15;
    reasons.push('Content can be condensed to single tweet');
  }

  if (signals.hasDiscovery) {
    score += 20;
    reasons.push('Discovery format works well as single');
  }

  if (!signals.hasMultipleParagraphs && !signals.hasTechnicalDepth) {
    score += 15;
    reasons.push('Simple structure suits single format');
  }

  if (THREAD_INDICATORS.some((ind) => contentLower.includes(ind))) {
    score -= 20;
    reasons.push('Thread indicators suggest expansion needed');
  }

  return { type: 'single', score, reasons };
}

function scoreQuote(signals: ContentTypeSignals, contentLower: string): ContentTypeScore {
  let score = 0;
  const reasons: string[] = [];

  if (signals.isQuotable) {
    score += 35;
    reasons.push('Content is quotable material');
  }

  if (signals.hasControversial) {
    score += 25;
    reasons.push('Controversial take benefits from quote format');
  }

  const quoteMatches = QUOTE_INDICATORS.filter((ind) => contentLower.includes(ind));
  if (quoteMatches.length > 0) {
    score += 20;
    reasons.push(`Quote indicators: ${quoteMatches.slice(0, 2).join(', ')}`);
  }

  if (signals.engagementLevel === 'high') {
    score += 15;
    reasons.push('High engagement tweet worth building on');
  }

  if (signals.length < 200 && score > 0) {
    score += 10;
    reasons.push('Short source leaves room for commentary');
  }

  return { type: 'quote', score, reasons };
}

function scoreReply(signals: ContentTypeSignals, contentLower: string): ContentTypeScore {
  let score = 0;
  const reasons: string[] = [];

  if (signals.isReplyContext) {
    score += 40;
    reasons.push('Content has reply context');
  }

  if (signals.hasQuestion) {
    score += 25;
    reasons.push('Contains question suggesting dialogue');
  }

  const replyMatches = REPLY_INDICATORS.filter((ind) => contentLower.includes(ind.toLowerCase()));
  if (replyMatches.length > 0) {
    score += 20;
    reasons.push(`Reply indicators: ${replyMatches.slice(0, 2).join(', ')}`);
  }

  if (signals.length < 150) {
    score += 10;
    reasons.push('Short content fits reply format');
  }

  return { type: 'reply', score, reasons };
}

export function selectContentType(source: Source): ContentTypeSelection {
  const signals = extractSignals(source);
  const contentLower = source.content.toLowerCase();

  const scores: ContentTypeScore[] = [
    scoreSingle(signals, contentLower),
    scoreThread(signals, contentLower),
    scoreQuote(signals, contentLower),
    scoreReply(signals, contentLower),
  ];

  scores.sort((a, b) => b.score - a.score);

  const recommended = scores[0].type;

  return {
    recommended,
    scores,
    signals,
  };
}

export function formatContentTypeSelection(selection: ContentTypeSelection): string {
  const lines: string[] = [];

  lines.push('=== CONTENT TYPE SELECTION ===');
  lines.push('');
  lines.push(`Recommended: ${selection.recommended.toUpperCase()}`);
  lines.push('');

  lines.push('--- SCORES ---');
  for (const score of selection.scores) {
    lines.push(`${score.type}: ${score.score}`);
    for (const reason of score.reasons) {
      lines.push(`  - ${reason}`);
    }
  }
  lines.push('');

  lines.push('--- SIGNALS ---');
  lines.push(`Length: ${selection.signals.length} chars`);
  lines.push(`Multiple paragraphs: ${selection.signals.hasMultipleParagraphs}`);
  lines.push(`Technical depth: ${selection.signals.hasTechnicalDepth}`);
  lines.push(`Has discovery: ${selection.signals.hasDiscovery}`);
  lines.push(`Has controversial: ${selection.signals.hasControversial}`);
  lines.push(`Reply context: ${selection.signals.isReplyContext}`);
  lines.push(`Quotable: ${selection.signals.isQuotable}`);
  lines.push(`Engagement: ${selection.signals.engagementLevel}`);

  return lines.join('\n');
}
