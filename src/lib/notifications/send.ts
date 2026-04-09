import type { NotificationType, NotificationVerbosity } from '@/types';
import { getDiscordConfig, sendWebhook, type SendResult } from './discord';
import {
  buildNotificationMessage,
  getDefaultVerbosityForType,
  type NotificationPayload,
} from './templates';

export interface SendTypedNotificationOptions {
  forceVerbosity?: NotificationVerbosity;
}

export async function sendTypedNotification<T extends NotificationType>(
  type: T,
  payload: NotificationPayload[T],
  options: SendTypedNotificationOptions = {}
): Promise<SendResult> {
  const config = getDiscordConfig();

  let verbosity: NotificationVerbosity;
  if (options.forceVerbosity) {
    verbosity = options.forceVerbosity;
  } else if (type === 'time_sensitive') {
    verbosity = 'rich';
  } else {
    verbosity = config.verbosity;
  }

  const message = buildNotificationMessage(type, payload, verbosity);
  return sendWebhook(message);
}

export async function sendTimeSensitiveNotification(
  payload: NotificationPayload['time_sensitive']
): Promise<SendResult> {
  return sendTypedNotification('time_sensitive', payload, { forceVerbosity: 'rich' });
}

export async function sendContentReadyNotification(
  payload: NotificationPayload['content_ready']
): Promise<SendResult> {
  return sendTypedNotification('content_ready', payload);
}

export async function sendAgentStuckNotification(
  payload: NotificationPayload['agent_stuck']
): Promise<SendResult> {
  return sendTypedNotification('agent_stuck', payload);
}

export async function sendBudgetWarningNotification(
  payload: NotificationPayload['budget_warning']
): Promise<SendResult> {
  return sendTypedNotification('budget_warning', payload);
}

export { getDefaultVerbosityForType };
