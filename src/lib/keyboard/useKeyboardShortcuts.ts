'use client';

import { useEffect, useCallback, useRef } from 'react';
import { FeedbackCategory } from '@/types';
import {
  ShortcutAction,
  ShortcutContext,
  getShortcutByKey,
  isShortcutActiveInContext,
} from './shortcuts';

export interface KeyboardHandlers {
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onQuickReject?: (category: FeedbackCategory) => void;
  onToggleHelp?: () => void;
}

export interface UseKeyboardShortcutsOptions {
  context: ShortcutContext;
  handlers: KeyboardHandlers;
  enabled?: boolean;
}

function isInputElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable
  );
}

export function useKeyboardShortcuts({
  context,
  handlers,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (!enabled) return;
      if (isInputElement(event.target)) return;

      const key = event.key;
      const shortcut = getShortcutByKey(key);

      if (!shortcut) return;
      if (!isShortcutActiveInContext(shortcut, context) && !shortcut.context.includes('global')) {
        return;
      }

      const actionMap: Record<ShortcutAction, () => void> = {
        approve: () => handlersRef.current.onApprove?.(),
        reject: () => handlersRef.current.onReject?.(),
        edit: () => handlersRef.current.onEdit?.(),
        navigateUp: () => handlersRef.current.onNavigateUp?.(),
        navigateDown: () => handlersRef.current.onNavigateDown?.(),
        expand: () => handlersRef.current.onExpand?.(),
        collapse: () => handlersRef.current.onCollapse?.(),
        quickRejectGeneric: () => handlersRef.current.onQuickReject?.('generic'),
        quickRejectTone: () => handlersRef.current.onQuickReject?.('tone'),
        quickRejectHook: () => handlersRef.current.onQuickReject?.('hook'),
        quickRejectValue: () => handlersRef.current.onQuickReject?.('value'),
        toggleHelp: () => handlersRef.current.onToggleHelp?.(),
      };

      const handler = actionMap[shortcut.action];
      event.preventDefault();
      handler();
    },
    [context, enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
