import { werewolfCheckpoints } from '../../data/worlds/lighthouse-town/map';
import type { WerewolfSeat } from './types';

export type WerewolfMovementCommand = {
  residentId: string;
  destination: { x: number; y: number };
  description: string;
  until: number;
};

export function buildWerewolfMovementCommands(
  seats: readonly WerewolfSeat[],
  phase: 'seating' | 'elimination' | 'return',
  now: number,
): WerewolfMovementCommand[] {
  if (seats.length !== 9 || new Set(seats.map((seat) => seat.playerId)).size !== 9) {
    throw new Error('Werewolf movement requires nine unique seats.');
  }
  if (!Number.isFinite(now)) throw new Error('Werewolf movement requires a finite timestamp.');
  const aiSeats = seats.filter((seat) => seat.kind === 'ai');
  if (phase === 'seating') {
    return aiSeats.map((seat) => ({
      residentId: seat.playerId,
      destination: { ...werewolfCheckpoints.seats[seat.seatNumber - 1] },
      description: `前往灯塔广场狼人杀圆桌，在 ${seat.seatNumber} 号座位就座`,
      until: now + 4 * 60 * 60_000,
    }));
  }
  if (phase === 'elimination') {
    return aiSeats.filter((seat) => !seat.alive).map((seat, index) => ({
      residentId: seat.playerId,
      destination: {
        ...werewolfCheckpoints.spectators[index % werewolfCheckpoints.spectators.length],
      },
      description: '安全离场后前往广场观众席，继续观看狼人杀',
      until: now + 4 * 60 * 60_000,
    }));
  }
  return aiSeats.map((seat) => ({
    residentId: seat.playerId,
    destination: { x: 22 + ((seat.seatNumber % 3) - 1), y: 20 + (seat.seatNumber % 2) },
    description: '狼人杀结束，离开圆桌回到小镇正常生活',
    until: now + 5 * 60_000,
  }));
}
