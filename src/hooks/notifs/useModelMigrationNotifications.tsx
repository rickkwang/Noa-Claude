// @ts-nocheck
import type { Notification } from 'src/context/notifications.js';
import { type GlobalConfig, getGlobalConfig } from 'src/utils/config.js';
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getMarketingNameForModel,
} from 'src/utils/model/model.js';
import { useStartupNotification } from './useStartupNotification.js';

// Both migrations below write a bare family alias ('opus' / 'sonnet'), so the
// version they land on is whatever that alias resolves to today — not the
// version that was current when the migration was written. Resolve the name at
// notification time so the text can't drift on the next model launch.
// @[MODEL LAUNCH]: nothing to update here — these follow the alias.
function currentAliasName(
  resolve: () => string,
  fallback: string,
): string {
  try {
    return getMarketingNameForModel(resolve()) ?? fallback;
  } catch {
    // Provider/settings lookups can throw before config is fully loaded; a
    // notification must never be the thing that breaks startup.
    return fallback;
  }
}

// Shows a one-time notification right after a model migration writes its
// timestamp to config. Each entry reads its own timestamp field(s) and emits
// a notification if the write happened within the last 3s (i.e. this launch).
// Future model migrations: add an entry to MIGRATIONS below.
const MIGRATIONS: ((c: GlobalConfig) => Notification | undefined)[] = [
// Sonnet 4.5 → current Sonnet (pro/max/team premium). Writes the 'sonnet'
// alias, so name the version that alias resolves to now.
c => {
  if (!recent(c.sonnet45To46MigrationTimestamp)) return;
  const name = currentAliasName(getDefaultSonnetModel, 'Sonnet');
  return {
    key: 'sonnet-46-update',
    text: `Model updated to ${name}`,
    color: 'suggestion',
    priority: 'high',
    timeoutMs: 3000
  };
},
// Opus Pro → default, or pinned 4.0/4.1 → opus alias. Both write the 'opus'
// alias and land on whatever the current Opus default is.
c => {
  const isLegacyRemap = Boolean(c.legacyOpusMigrationTimestamp);
  const ts = c.legacyOpusMigrationTimestamp ?? c.opusProMigrationTimestamp;
  if (!recent(ts)) return;
  const name = currentAliasName(getDefaultOpusModel, 'Opus');
  return {
    key: 'opus-pro-update',
    text: isLegacyRemap ? `Model updated to ${name} · Set CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out` : `Model updated to ${name}`,
    color: 'suggestion',
    priority: 'high',
    timeoutMs: isLegacyRemap ? 8000 : 3000
  };
}];
export function useModelMigrationNotifications() {
  useStartupNotification(_temp);
}
function _temp() {
  const config = getGlobalConfig();
  const notifs = [];
  for (const migration of MIGRATIONS) {
    const notif = migration(config);
    if (notif) {
      notifs.push(notif);
    }
  }
  return notifs.length > 0 ? notifs : null;
}
function recent(ts: number | undefined): boolean {
  return ts !== undefined && Date.now() - ts < 3000;
}
