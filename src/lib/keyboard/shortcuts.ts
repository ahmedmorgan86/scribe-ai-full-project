import { FeedbackCategory } from '@/types';

export type ShortcutContext = 'global' | 'queue' | 'expanded' | 'rejection';

export type ShortcutAction =
  | 'approve'
  | 'reject'
  | 'edit'
  | 'navigateUp'
  | 'navigateDown'
  | 'expand'
  | 'collapse'
  | 'quickRejectGeneric'
  | 'quickRejectTone'
  | 'quickRejectHook'
  | 'quickRejectValue'
  | 'toggleHelp';

export interface ShortcutDefinition {
  key: string;
  action: ShortcutAction;
  description: string;
  context: ShortcutContext[];
  category?: FeedbackCategory;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  {
    key: 'a',
    action: 'approve',
    description: 'Approve current post',
    context: ['queue', 'expanded'],
  },
  {
    key: 'r',
    action: 'reject',
    description: 'Reject (opens category selection)',
    context: ['queue', 'expanded'],
  },
  {
    key: 'e',
    action: 'edit',
    description: 'Edit current post',
    context: ['queue', 'expanded'],
  },
  {
    key: 'g',
    action: 'quickRejectGeneric',
    description: 'Quick reject as Generic',
    context: ['queue', 'expanded', 'rejection'],
    category: 'generic',
  },
  {
    key: 't',
    action: 'quickRejectTone',
    description: 'Quick reject as Tone',
    context: ['queue', 'expanded', 'rejection'],
    category: 'tone',
  },
  {
    key: 'h',
    action: 'quickRejectHook',
    description: 'Quick reject as Hook',
    context: ['queue', 'expanded', 'rejection'],
    category: 'hook',
  },
  {
    key: 'v',
    action: 'quickRejectValue',
    description: 'Quick reject as Value',
    context: ['queue', 'expanded', 'rejection'],
    category: 'value',
  },
  {
    key: 'j',
    action: 'navigateDown',
    description: 'Navigate to next post',
    context: ['queue'],
  },
  {
    key: 'k',
    action: 'navigateUp',
    description: 'Navigate to previous post',
    context: ['queue'],
  },
  {
    key: 'Enter',
    action: 'expand',
    description: 'Expand current post',
    context: ['queue'],
  },
  {
    key: 'Escape',
    action: 'collapse',
    description: 'Close expanded view / cancel action',
    context: ['expanded', 'rejection', 'global'],
  },
  {
    key: '?',
    action: 'toggleHelp',
    description: 'Toggle keyboard shortcuts help',
    context: ['global'],
  },
];

export function getShortcutByKey(key: string): ShortcutDefinition | undefined {
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
  return SHORTCUTS.find((s) => s.key === normalizedKey || s.key.toLowerCase() === normalizedKey);
}

export function getShortcutsByContext(context: ShortcutContext): ShortcutDefinition[] {
  return SHORTCUTS.filter((s) => s.context.includes(context));
}

export function getShortcutForAction(action: ShortcutAction): ShortcutDefinition | undefined {
  return SHORTCUTS.find((s) => s.action === action);
}

export function isShortcutActiveInContext(
  shortcut: ShortcutDefinition,
  context: ShortcutContext
): boolean {
  return shortcut.context.includes(context);
}

export function formatShortcutKey(key: string): string {
  const keyMap: Record<string, string> = {
    Enter: '↵',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return keyMap[key] ?? key.toUpperCase();
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutDefinition[];
}

export function getShortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: 'Navigation',
      shortcuts: SHORTCUTS.filter((s) =>
        ['navigateUp', 'navigateDown', 'expand', 'collapse'].includes(s.action)
      ),
    },
    {
      title: 'Actions',
      shortcuts: SHORTCUTS.filter((s) => ['approve', 'reject', 'edit'].includes(s.action)),
    },
    {
      title: 'Quick Reject',
      shortcuts: SHORTCUTS.filter((s) => s.action.startsWith('quickReject')),
    },
    {
      title: 'Other',
      shortcuts: SHORTCUTS.filter((s) => s.action === 'toggleHelp'),
    },
  ];
}
