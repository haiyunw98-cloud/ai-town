import { useCallback, useEffect, useRef, useState } from 'react';
import type { WerewolfPhase } from '../../convex/werewolf/types';
import { WEREWOLF_PHASE_ORDER } from './werewolfJudge';

const phaseDwell: Record<WerewolfPhase, number> = {
  'night-wolves': 6000,
  'night-seer': 4000,
  'night-witch': 4000,
  dawn: 5000,
  'day-speaking': 5000,
  'day-voting': 5000,
  'runoff-speaking': 4000,
  'runoff-voting': 4000,
  hunter: 4000,
  completed: 8000,
};

export type TheatreStep = { phase: WerewolfPhase; round: number };

export function phaseDwellMs(phase: WerewolfPhase, speed: 1 | 2) {
  return phaseDwell[phase] / speed;
}

export function theatreStepsForSnapshot(
  previous: TheatreStep | undefined,
  phase: WerewolfPhase,
  round: number,
  replayOpening: boolean,
): TheatreStep[] {
  if (previous?.phase === phase && previous.round === round) return [];
  const currentIndex = WEREWOLF_PHASE_ORDER.indexOf(phase);
  if (!previous) {
    const phases = replayOpening && round === 1 && currentIndex > 0 &&
      currentIndex <= WEREWOLF_PHASE_ORDER.indexOf('day-voting')
      ? WEREWOLF_PHASE_ORDER.slice(0, currentIndex + 1)
      : [phase];
    return phases.map((candidate) => ({ phase: candidate, round }));
  }
  const previousIndex = WEREWOLF_PHASE_ORDER.indexOf(previous.phase);
  const phases = previous.round === round
    ? (currentIndex > previousIndex
      ? WEREWOLF_PHASE_ORDER.slice(previousIndex + 1, currentIndex + 1)
      : [phase])
    : (round > previous.round && replayOpening && currentIndex > 0
      ? WEREWOLF_PHASE_ORDER.slice(0, currentIndex + 1)
      : [phase]);
  return phases.map((candidate) => ({ phase: candidate, round }));
}

export function useWerewolfTheatre(
  phase: WerewolfPhase | undefined,
  round: number | undefined,
  speed: 1 | 2,
  replayOpening: boolean,
) {
  const initial = phase && round
    ? theatreStepsForSnapshot(undefined, phase, round, replayOpening)
    : [];
  const [queue, setQueue] = useState<TheatreStep[]>(initial);
  const lastObserved = useRef<TheatreStep | undefined>(initial.at(-1));

  useEffect(() => {
    if (!phase || !round) return;
    const incoming = theatreStepsForSnapshot(lastObserved.current, phase, round, replayOpening);
    lastObserved.current = { phase, round };
    setQueue((current) => {
      const keys = new Set(current.map((step) => `${step.round}:${step.phase}`));
      return [...current, ...incoming.filter((step) => !keys.has(`${step.round}:${step.phase}`))];
    });
  }, [phase, replayOpening, round]);

  useEffect(() => {
    if (queue.length <= 1) return;
    const timer = window.setTimeout(() => {
      setQueue((current) => current.length > 1 ? current.slice(1) : current);
    }, phaseDwellMs(queue[0].phase, speed));
    return () => window.clearTimeout(timer);
  }, [queue, speed]);

  const skip = useCallback(() => {
    setQueue((current) => current.length > 1 ? current.slice(1) : current);
  }, []);

  return {
    presentedPhase: queue[0]?.phase ?? phase,
    presentedRound: queue[0]?.round ?? round,
    catchingUp: queue.length > 1,
    skip,
  };
}
