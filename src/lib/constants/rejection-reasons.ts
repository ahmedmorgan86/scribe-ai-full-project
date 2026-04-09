/**
 * Predefined rejection reasons for post categorization.
 * Used for pattern learning and analytics.
 */

export interface RejectionReason {
  id: string;
  label: string;
  description: string;
  category: 'voice' | 'content' | 'style' | 'other';
  shortcut?: string; // Keyboard shortcut (1-9)
}

export const REJECTION_REASONS: readonly RejectionReason[] = [
  {
    id: 'wrong_tone',
    label: 'Wrong Tone',
    description: "Doesn't match my voice",
    category: 'voice',
    shortcut: '1',
  },
  {
    id: 'too_formal',
    label: 'Too Formal',
    description: 'Sounds corporate/stiff',
    category: 'voice',
    shortcut: '2',
  },
  {
    id: 'too_casual',
    label: 'Too Casual',
    description: 'Too informal for topic',
    category: 'voice',
    shortcut: '3',
  },
  {
    id: 'ai_slop',
    label: 'AI Slop',
    description: 'Generic AI-sounding phrases',
    category: 'style',
    shortcut: '4',
  },
  {
    id: 'off_topic',
    label: 'Off Topic',
    description: 'Not relevant to my niche',
    category: 'content',
    shortcut: '5',
  },
  {
    id: 'too_promotional',
    label: 'Too Promotional',
    description: 'Feels salesy/pushy',
    category: 'style',
    shortcut: '6',
  },
  {
    id: 'factually_wrong',
    label: 'Factually Wrong',
    description: 'Incorrect information',
    category: 'content',
    shortcut: '7',
  },
  {
    id: 'already_posted',
    label: 'Already Posted',
    description: 'Similar content exists',
    category: 'content',
    shortcut: '8',
  },
  {
    id: 'not_interesting',
    label: 'Not Interesting',
    description: 'Boring/no hook',
    category: 'content',
    shortcut: '9',
  },
  {
    id: 'too_long',
    label: 'Too Long',
    description: 'Exceeds ideal length',
    category: 'style',
    shortcut: '0',
  },
  {
    id: 'too_short',
    label: 'Too Short',
    description: 'Not enough substance',
    category: 'style',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Custom reason',
    category: 'other',
  },
] as const;

export type RejectionReasonId = (typeof REJECTION_REASONS)[number]['id'];

export function getRejectionReasonById(id: string): RejectionReason | undefined {
  return REJECTION_REASONS.find((r) => r.id === id);
}

export function getRejectionReasonByShortcut(shortcut: string): RejectionReason | undefined {
  return REJECTION_REASONS.find((r) => r.shortcut === shortcut);
}

export function isValidRejectionReason(id: string): boolean {
  return REJECTION_REASONS.some((r) => r.id === id);
}

export function getRejectionReasonsByCategory(
  category: RejectionReason['category']
): RejectionReason[] {
  return REJECTION_REASONS.filter((r) => r.category === category);
}
