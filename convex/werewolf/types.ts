export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';

export type WerewolfEntrant = Readonly<{
  playerId: string;
  displayName: string;
  kind: 'ai' | 'human';
}>;

export type WerewolfSeat = WerewolfEntrant & {
  seatNumber: number;
  role: WerewolfRole;
  alive: boolean;
  eliminatedRound?: number;
  eliminatedBy?: 'wolves' | 'witch' | 'vote' | 'hunter';
  antidoteAvailable: boolean;
  poisonAvailable: boolean;
  hunterShotAvailable: boolean;
};

export type WerewolfCamp = 'wolves' | 'good';

export type WerewolfPhase =
  | 'night-wolves'
  | 'night-seer'
  | 'night-witch'
  | 'dawn'
  | 'day-speaking'
  | 'day-voting'
  | 'runoff-speaking'
  | 'runoff-voting'
  | 'hunter'
  | 'completed';

export type WerewolfAction =
  | { kind: 'wolf-vote'; actorId: string; targetId: string; at: number }
  | { kind: 'seer-check'; actorId: string; targetId: string; at: number }
  | { kind: 'witch-use'; actorId: string; save: boolean; poisonTargetId?: string; at: number };

export type WerewolfPrivateResult = {
  targetId: string;
  camp: WerewolfCamp;
};

export type WerewolfState = {
  seed: number;
  round: number;
  phase: WerewolfPhase;
  seats: WerewolfSeat[];
  actions: WerewolfAction[];
  pendingNightTargetId?: string;
  pendingPoisonTargetId?: string;
  nightSaved: boolean;
  speakingOrder: string[];
  runoffIds: string[];
  privateResults: Record<string, WerewolfPrivateResult[]>;
  winner?: WerewolfCamp | 'draw';
  updatedAt: number;
};
