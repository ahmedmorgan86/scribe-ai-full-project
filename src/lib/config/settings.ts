/**
 * Application settings configuration
 * Reads from database first, then environment variables, then defaults
 */

import { getDb } from '@/db/connection';

export interface HumanizerSettings {
  autoHumanize: boolean;
}

export interface AppSettings {
  humanizer: HumanizerSettings;
}

interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Get a setting from database
 */
function getSettingFromDb(key: string): string | null {
  try {
    const db = getDb();
    const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
    const row = stmt.get(key) as AppSettingRow | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Set a setting in database
 */
export function setSetting(key: string, value: string): void {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `);
    stmt.run(key, value, value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to save setting '${key}': ${message}`);
  }
}

/**
 * Get humanizer settings from database, falling back to environment variables
 */
export function getHumanizerSettings(): HumanizerSettings {
  const dbValue = getSettingFromDb('autoHumanize');
  if (dbValue !== null) {
    return {
      autoHumanize: dbValue === 'true',
    };
  }

  return {
    autoHumanize: getEnvBoolean('AUTO_HUMANIZE_CONTENT', true),
  };
}

/**
 * Update humanizer settings in database
 */
export function setHumanizerSettings(settings: Partial<HumanizerSettings>): void {
  if (settings.autoHumanize !== undefined) {
    setSetting('autoHumanize', settings.autoHumanize.toString());
  }
}

/**
 * Get all application settings
 */
export function getAppSettings(): AppSettings {
  return {
    humanizer: getHumanizerSettings(),
  };
}

/**
 * Check if auto-humanize is enabled
 */
export function isAutoHumanizeEnabled(): boolean {
  return getHumanizerSettings().autoHumanize;
}
