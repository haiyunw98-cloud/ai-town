export type GodModeCommandId = 'work' | 'rest' | 'eat' | 'shop' | 'plaza';

export const godModeQuickCommands: ReadonlyArray<{
  id: GodModeCommandId;
  label: string;
  landmarkId: 'workplace' | 'tea-house' | 'restaurant' | 'morning-market' | 'plaza';
  emoji: string;
  durationMs: number;
}> = [
  { id: 'work', label: '去工作', landmarkId: 'workplace', emoji: '💼', durationMs: 2 * 60 * 60_000 },
  { id: 'rest', label: '去休息', landmarkId: 'tea-house', emoji: '🍵', durationMs: 45 * 60_000 },
  { id: 'eat', label: '去吃饭', landmarkId: 'restaurant', emoji: '🍜', durationMs: 45 * 60_000 },
  { id: 'shop', label: '去购物', landmarkId: 'morning-market', emoji: '🧺', durationMs: 60 * 60_000 },
  { id: 'plaza', label: '到广场', landmarkId: 'plaza', emoji: '🎯', durationMs: 30 * 60_000 },
];
