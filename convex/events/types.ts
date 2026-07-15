export type EventPhase =
  | 'announcement'
  | 'treasureHunt'
  | 'lanternRelay'
  | 'secretTrade'
  | 'lighthouseFinal'
  | 'awards';

export type ParticipantRole =
  | 'competitor'
  | 'commentator'
  | 'helper'
  | 'interferer'
  | 'winner';

export type EventParticipant = {
  residentId: string;
  displayName: string;
  score: number;
  shells: number;
  active: boolean;
  role: ParticipantRole;
  rank?: number;
};

export type EventLogEntry = {
  eventKey: string;
  sequence: number;
  kind: 'announcement' | 'phase' | 'elimination' | 'awards';
  text: string;
  createdAt: number;
};

export type TownEventState = {
  worldId: string;
  seed: number;
  phase: EventPhase;
  phaseEndsAt: number;
  activeCount: number;
  participants: EventParticipant[];
  winnerId?: string;
  log: EventLogEntry[];
};

export type ResidentEntry = {
  residentId: string;
  displayName: string;
};
