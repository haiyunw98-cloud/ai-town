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
