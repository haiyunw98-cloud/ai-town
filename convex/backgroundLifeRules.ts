export const BACKGROUND_LIFE_SLOT_MS = 30 * 60 * 1_000;
export const BACKGROUND_LIFE_MAX_CATCH_UP_MS = 7 * 24 * 60 * 60 * 1_000;
export const BACKGROUND_LIFE_BATCH_SIZE = 12;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export type BackgroundLifeActionKind = 'work' | 'purchase' | 'social' | 'rest';

export type BackgroundLifeAction = {
  slot: number;
  residentIndex: number;
  partnerIndex?: number;
  kind: BackgroundLifeActionKind;
};

export function backgroundLifeModeForWorldStatus(
  status: 'running' | 'inactive' | 'stoppedByDeveloper',
) {
  if (status === 'inactive') return 'simulate' as const;
  if (status === 'stoppedByDeveloper') return 'hold-without-catch-up' as const;
  return 'foreground' as const;
}

export function floorBackgroundLifeSlot(timestamp: number) {
  assertTimestamp(timestamp);
  return Math.floor(timestamp / BACKGROUND_LIFE_SLOT_MS) * BACKGROUND_LIFE_SLOT_MS;
}

export function backgroundLifeActionForSlot(
  timestamp: number,
  residentCount: number,
): BackgroundLifeAction {
  const slot = floorBackgroundLifeSlot(timestamp);
  if (!Number.isSafeInteger(residentCount) || residentCount < 2) {
    throw new Error('residentCount must be a safe integer of at least two');
  }
  const absoluteSlot = Math.floor(slot / BACKGROUND_LIFE_SLOT_MS);
  const residentIndex = positiveModulo(absoluteSlot, residentCount);
  const shanghai = new Date(slot + SHANGHAI_OFFSET_MS);
  const hour = shanghai.getUTCHours();
  let kind: BackgroundLifeActionKind;
  if (hour >= 7 && hour < 12) kind = 'work';
  else if (hour >= 12 && hour < 14) kind = 'purchase';
  else if (hour >= 14 && hour < 18) kind = absoluteSlot % 3 === 0 ? 'purchase' : 'work';
  else if (hour >= 18 && hour < 22) kind = absoluteSlot % 3 === 0 ? 'purchase' : 'social';
  else kind = 'rest';

  if (kind !== 'social') return { slot, residentIndex, kind };
  const dayNumber = Math.floor((slot + SHANGHAI_OFFSET_MS) / (24 * 60 * 60 * 1_000));
  const partnerOffset = 1 + positiveModulo(dayNumber + absoluteSlot, residentCount - 1);
  return {
    slot,
    residentIndex,
    partnerIndex: (residentIndex + partnerOffset) % residentCount,
    kind,
  };
}

export function backgroundLifeSlotsToProcess(
  lastProcessedSlot: number,
  currentTimestamp: number,
  batchSize = BACKGROUND_LIFE_BATCH_SIZE,
) {
  const currentSlot = floorBackgroundLifeSlot(currentTimestamp);
  assertTimestamp(lastProcessedSlot);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 96) {
    throw new Error('batchSize must be a safe integer between 1 and 96');
  }
  const earliestDetailedSlot = currentSlot - BACKGROUND_LIFE_MAX_CATCH_UP_MS;
  const requestedNext = floorBackgroundLifeSlot(lastProcessedSlot) + BACKGROUND_LIFE_SLOT_MS;
  const firstSlot = Math.max(requestedNext, earliestDetailedSlot);
  const skippedBefore = requestedNext < earliestDetailedSlot ? earliestDetailedSlot : undefined;
  const slots: number[] = [];
  for (
    let slot = firstSlot;
    slot <= currentSlot && slots.length < batchSize;
    slot += BACKGROUND_LIFE_SLOT_MS
  ) {
    slots.push(slot);
  }
  const finalSlot = slots.at(-1) ?? floorBackgroundLifeSlot(lastProcessedSlot);
  return {
    slots,
    skippedBefore,
    hasMore: finalSlot < currentSlot,
    currentSlot,
  };
}

export function backgroundLifeIdempotencyKey(
  worldId: string,
  timestamp: number,
  suffix: string,
) {
  const slot = floorBackgroundLifeSlot(timestamp);
  if (!/^[a-z0-9][a-z0-9:._-]*$/u.test(worldId)) throw new Error('invalid worldId');
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(suffix)) throw new Error('invalid suffix');
  return `background:${worldId}:${slot}:${suffix}`;
}

function assertTimestamp(timestamp: number) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('timestamp must be a nonnegative safe integer');
  }
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
