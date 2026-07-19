export const DAILY_TEMPLATE_IDS = [
  'safe-survival',
  'town-relay',
  'island-resources',
  'market-business',
  'community-service',
  'cooking-craft',
  'relay-build',
] as const;

export type DailyTemplateId = (typeof DAILY_TEMPLATE_IDS)[number];

const SHANGHAI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const EVENT_START_MINUTE = 12 * 60;
const EVENT_END_MINUTE = 14 * 60;
const STAGE_START_MINUTES = [0, 10, 35, 60, 70, 90, 110] as const;

export type DailyEventWindow =
  | { state: 'before'; stageIndex: -1 }
  | { state: 'live'; stageIndex: number; elapsedMinutes: number }
  | { state: 'after'; stageIndex: 7 };

export function shanghaiEventDayKey(timestamp: number): string {
  const date = new Date(timestamp + SHANGHAI_OFFSET_MILLISECONDS);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function dailyEventWindow(timestamp: number): DailyEventWindow {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MILLISECONDS);
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  if (minuteOfDay < EVENT_START_MINUTE) return { state: 'before', stageIndex: -1 };
  if (minuteOfDay >= EVENT_END_MINUTE) return { state: 'after', stageIndex: 7 };

  const elapsedMinutes = minuteOfDay - EVENT_START_MINUTE;
  let stageIndex = 0;
  for (let index = 1; index < STAGE_START_MINUTES.length; index += 1) {
    if (elapsedMinutes < STAGE_START_MINUTES[index]) break;
    stageIndex = index;
  }
  return { state: 'live', stageIndex, elapsedMinutes };
}

export function selectDailyTemplate(
  dayKey: string,
  previousTemplateIds: readonly string[],
): DailyTemplateId {
  const recentlyUsed = new Set(previousTemplateIds.slice(-6));
  const unused = DAILY_TEMPLATE_IDS.filter((id) => !recentlyUsed.has(id));
  const candidates = unused.length > 0 ? unused : DAILY_TEMPLATE_IDS;
  let hash = 0;
  for (const character of dayKey) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  }
  return candidates[(hash >>> 0) % candidates.length];
}

export type WorldRunStatus = 'running' | 'inactive' | 'stoppedByDeveloper';

export type ExistingDailyEvent = {
  status: 'running' | 'completed';
  stageIndex: number;
};

export type DailyEventAction =
  | { kind: 'none' }
  | { kind: 'create' | 'advance'; stageIndex: number }
  | { kind: 'archive'; stageIndex: 6 }
  | { kind: 'archive-paused' }
  | { kind: 'record-missed' };

export function dailyEventAction(
  timestamp: number,
  worldStatus: WorldRunStatus,
  existing: ExistingDailyEvent | null,
): DailyEventAction {
  const window = dailyEventWindow(timestamp);
  if (window.state === 'before' || existing?.status === 'completed') return { kind: 'none' };

  if (window.state === 'live') {
    if (worldStatus !== 'running') return { kind: 'none' };
    if (!existing) return { kind: 'create', stageIndex: window.stageIndex };
    return existing.stageIndex < window.stageIndex
      ? { kind: 'advance', stageIndex: window.stageIndex }
      : { kind: 'none' };
  }

  if (!existing) return { kind: 'record-missed' };
  if (worldStatus !== 'running') return { kind: 'archive-paused' };
  return { kind: 'archive', stageIndex: 6 };
}
