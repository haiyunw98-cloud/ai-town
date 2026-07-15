import {
  EventLogEntry,
  EventParticipant,
  EventPhase,
  ParticipantRole,
  ResidentEntry,
  TownEventState,
} from './types';

const phaseDuration: Record<EventPhase, number> = {
  announcement: 60_000,
  treasureHunt: 4 * 60_000,
  lanternRelay: 4 * 60_000,
  secretTrade: 4 * 60_000,
  lighthouseFinal: 5 * 60_000,
  awards: 24 * 60 * 60_000,
};

const nextPhase: Partial<Record<EventPhase, EventPhase>> = {
  announcement: 'treasureHunt',
  treasureHunt: 'lanternRelay',
  lanternRelay: 'secretTrade',
  secretTrade: 'lighthouseFinal',
  lighthouseFinal: 'awards',
};

const targetActive: Record<EventPhase, number> = {
  announcement: 8,
  treasureHunt: 8,
  lanternRelay: 6,
  secretTrade: 4,
  lighthouseFinal: 2,
  awards: 1,
};

const phaseLabel: Record<EventPhase, string> = {
  announcement: '全镇公告',
  treasureHunt: '八人寻宝冲刺',
  lanternRelay: '双人灯火接力',
  secretTrade: '四人秘密交易',
  lighthouseFinal: '灯塔点灯决赛',
  awards: '百万金贝颁奖礼',
};

export function createInitialEvent(
  worldId: string,
  residents: ResidentEntry[],
  seed: number,
  now = Date.now(),
): TownEventState {
  if (residents.length !== 8) throw new Error('The challenge requires exactly eight residents.');
  const participants = residents.map<EventParticipant>((resident) => ({
    ...resident,
    score: 0,
    shells: 0,
    active: true,
    role: 'competitor',
  }));
  return {
    worldId,
    seed,
    phase: 'announcement',
    phaseEndsAt: now + phaseDuration.announcement,
    activeCount: 8,
    participants,
    log: [
      {
        eventKey: 'announcement:0',
        sequence: 0,
        kind: 'announcement',
        text: '灯塔镇百万金贝寻宝赛正式公布，八位居民正在前往灯塔广场！',
        createdAt: now,
      },
    ],
  };
}

export function advanceEvent(event: TownEventState, now: number): TownEventState {
  if (event.phase === 'awards' || now < event.phaseEndsAt) return event;
  const phase = nextPhase[event.phase];
  if (!phase) return event;

  const scored = event.participants.map((participant) =>
    participant.active
      ? addRoundScore(participant, event.seed, phase, event.log.length)
      : { ...participant },
  );
  const active = scored
    .filter((participant) => participant.active)
    .sort(compareParticipants);
  const survivors = new Set(active.slice(0, targetActive[phase]).map((entry) => entry.residentId));
  const ranked = [...scored].sort(compareParticipants);
  const participants = scored.map<EventParticipant>((participant) => {
    const rank = ranked.findIndex((entry) => entry.residentId === participant.residentId) + 1;
    if (!participant.active) return { ...participant, rank };
    if (survivors.has(participant.residentId)) {
      return {
        ...participant,
        active: true,
        role: phase === 'awards' ? 'winner' : 'competitor',
        rank,
      };
    }
    return { ...participant, active: false, role: eliminatedRole(rank), rank };
  });
  const eliminated = participants.filter(
    (participant) => event.participants.find((entry) => entry.residentId === participant.residentId)?.active && !participant.active,
  );
  const log = appendPhaseLog(event.log, phase, participants, eliminated, now);
  const winner = phase === 'awards' ? participants.find((participant) => participant.active) : undefined;
  return {
    ...event,
    phase,
    phaseEndsAt: now + phaseDuration[phase],
    activeCount: targetActive[phase],
    participants,
    winnerId: winner?.residentId,
    log,
  };
}

function addRoundScore(
  participant: EventParticipant,
  seed: number,
  phase: EventPhase,
  round: number,
): EventParticipant {
  const roll = seededRoll(`${seed}:${phase}:${round}:${participant.residentId}`);
  const shells = phase === 'treasureHunt' ? 1 + (roll % 3) : 0;
  return {
    ...participant,
    score: participant.score + 20 + roll,
    shells: participant.shells + shells,
  };
}

function compareParticipants(left: EventParticipant, right: EventParticipant) {
  return right.score - left.score || right.shells - left.shells || left.residentId.localeCompare(right.residentId);
}

function eliminatedRole(rank: number): ParticipantRole {
  return (['commentator', 'helper', 'interferer'] as const)[rank % 3];
}

function appendPhaseLog(
  existing: EventLogEntry[],
  phase: EventPhase,
  participants: EventParticipant[],
  eliminated: EventParticipant[],
  now: number,
) {
  const next = [...existing];
  const phaseEntry: EventLogEntry = {
    eventKey: `${phase}:${next.length}`,
    sequence: next.length,
    kind: phase === 'awards' ? 'awards' : 'phase',
    text:
      phase === 'awards'
        ? `${participants.find((participant) => participant.active)?.displayName}赢得百万金贝大奖，并点亮了灯塔！`
        : `${phaseLabel[phase]}开始，剩余 ${targetActive[phase]} 位选手仍在争夺大奖。`,
    createdAt: now,
  };
  next.push(phaseEntry);
  for (const participant of eliminated) {
    next.push({
      eventKey: `${phase}:eliminated:${participant.residentId}`,
      sequence: next.length,
      kind: 'elimination',
      text: `${participant.displayName}结束竞赛，转任${roleLabel(participant.role)}继续参与。`,
      createdAt: now,
    });
  }
  return next;
}

function roleLabel(role: ParticipantRole) {
  if (role === 'helper') return '场外助手';
  if (role === 'interferer') return '神秘干扰者';
  return '赛事评论员';
}

function seededRoll(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 81;
}
