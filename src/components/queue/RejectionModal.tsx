'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  REJECTION_REASONS,
  getRejectionReasonByShortcut,
  type RejectionReason,
} from '@/lib/constants/rejection-reasons';

interface RejectionModalProps {
  isOpen: boolean;
  postId: number;
  onConfirm: (reason: string, comment?: string) => void;
  onCancel: () => void;
}

export function RejectionModal({
  isOpen,
  postId,
  onConfirm,
  onCancel,
}: RejectionModalProps): React.ReactElement | null {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedReason('');
      setComment('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = (): void => {
    if (!selectedReason || isSubmitting) return;
    setIsSubmitting(true);
    onConfirm(selectedReason, comment || undefined);
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Escape to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      // Enter to confirm (if reason selected)
      if (e.key === 'Enter' && selectedReason !== '' && !isSubmitting) {
        e.preventDefault();
        setIsSubmitting(true);
        onConfirm(selectedReason, comment || undefined);
        return;
      }

      // Number keys for quick selection
      if (/^[0-9]$/.test(e.key)) {
        const reason = getRejectionReasonByShortcut(e.key);
        if (reason) {
          e.preventDefault();
          setSelectedReason(reason.id);
        }
      }
    },
    [isOpen, selectedReason, isSubmitting, onCancel, comment, onConfirm]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  const groupedReasons = {
    voice: REJECTION_REASONS.filter((r) => r.category === 'voice'),
    content: REJECTION_REASONS.filter((r) => r.category === 'content'),
    style: REJECTION_REASONS.filter((r) => r.category === 'style'),
    other: REJECTION_REASONS.filter((r) => r.category === 'other'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Why are you rejecting this post?</h3>
          <p className="text-sm text-gray-400 mt-1">
            Post #{postId} • Use number keys for quick selection
          </p>
        </div>

        {/* Reasons Grid */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Voice Issues */}
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Voice Issues
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {groupedReasons.voice.map((reason) => (
                <ReasonButton
                  key={reason.id}
                  reason={reason}
                  isSelected={selectedReason === reason.id}
                  onClick={() => setSelectedReason(reason.id)}
                />
              ))}
            </div>
          </div>

          {/* Content Issues */}
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Content Issues
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {groupedReasons.content.map((reason) => (
                <ReasonButton
                  key={reason.id}
                  reason={reason}
                  isSelected={selectedReason === reason.id}
                  onClick={() => setSelectedReason(reason.id)}
                />
              ))}
            </div>
          </div>

          {/* Style Issues */}
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Style Issues
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {groupedReasons.style.map((reason) => (
                <ReasonButton
                  key={reason.id}
                  reason={reason}
                  isSelected={selectedReason === reason.id}
                  onClick={() => setSelectedReason(reason.id)}
                />
              ))}
            </div>
          </div>

          {/* Other */}
          <div>
            <div className="grid grid-cols-2 gap-2">
              {groupedReasons.other.map((reason) => (
                <ReasonButton
                  key={reason.id}
                  reason={reason}
                  isSelected={selectedReason === reason.id}
                  onClick={() => setSelectedReason(reason.id)}
                />
              ))}
            </div>
          </div>

          {/* Comment Field (shown when 'other' is selected or always visible) */}
          {selectedReason === 'other' && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Describe the issue
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What's wrong with this post?"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 focus:border-red-500 focus:outline-none resize-none"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between bg-gray-800/50">
          <span className="text-xs text-gray-500">
            Press <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300">Esc</kbd> to
            cancel, <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300">Enter</kbd> to
            confirm
          </span>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!selectedReason || isSubmitting}
              className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Rejecting...' : 'Reject Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReasonButtonProps {
  reason: RejectionReason;
  isSelected: boolean;
  onClick: () => void;
}

function ReasonButton({ reason, isSelected, onClick }: ReasonButtonProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 text-left rounded-lg border transition-all ${
        isSelected
          ? 'bg-red-500/20 border-red-500 text-red-400'
          : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-gray-700'
      }`}
    >
      {reason.shortcut && (
        <span
          className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-medium rounded ${
            isSelected ? 'bg-red-500/30 text-red-300' : 'bg-gray-700 text-gray-400'
          }`}
        >
          {reason.shortcut}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{reason.label}</div>
        <div className="text-xs text-gray-500 truncate">{reason.description}</div>
      </div>
    </button>
  );
}

export default RejectionModal;
