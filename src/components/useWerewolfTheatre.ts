import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function phaseDwellMs(phase: WerewolfPhase, speed: 1 | 2) {
  return phaseDwell[phase] / speed;
}

export function initialTheatreQueue(
  phase: WerewolfPhase,
  round: number,
  replayOpening: boolean,
): WerewolfPhase[] {
  if (!replayOpening || round !== 1) return [phase];
  const currentIndex = WEREWOLF_PHASE_ORDER.indexOf(phase);
  if (currentIndex <= 0 || currentIndex > WEREWOLF_PHASE_ORDER.indexOf('day-voting')) return [phase];
  return WEREWOLF_PHASE_ORDER.slice(0, currentIndex + 1);
}

export function useWerewolfTheatre(
  phase: WerewolfPhase,
  round: number,
  speed: 1 | 2,
  replayOpening: boolean,
) {
  const initial = useMemo(
    () => initialTheatreQueue(phase, round, replayOpening),
    // The opening queue must be chosen only when the venue mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [queue, setQueue] = useState<WerewolfPhase[]>(initial);

  useEffect(() => {
    const incoming = initialTheatreQueue(phase, round, replayOpening);
    setQueue((current) => [
      ...current,
      ...incoming.filter((candidate) => !current.includes(candidate)),
    ]);
  }, [phase, replayOpening, round]);

  useEffect(() => {
    if (queue.length <= 1) return;
    const timer = window.setTimeout(() => {
      setQueue((current) => current.length > 1 ? current.slice(1) : current);
    }, phaseDwellMs(queue[0], speed));
    return () => window.clearTimeout(timer);
  }, [queue, speed]);

  const skip = useCallback(() => {
    setQueue((current) => current.length > 1 ? current.slice(1) : current);
  }, []);

  return {
    presentedPhase: queue[0] ?? phase,
    catchingUp: queue.length > 1,
    skip,
  };
}
