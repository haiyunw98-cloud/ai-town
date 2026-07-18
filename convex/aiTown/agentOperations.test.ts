import { nextActivitySettlementAttempt } from './agentOperations';

type RetryArgs = Parameters<typeof nextActivitySettlementAttempt>[1];

const args = {
  activityUntil: 10_000,
  arrivalGraceStartedAt: undefined as number | undefined,
  lastAttemptAt: 10_000,
  pauseRetryCount: 0,
};

describe('activity settlement retry policy', () => {
  test('paused worlds retry in sixty seconds without consuming arrival grace', () => {
    expect(nextActivitySettlementAttempt({ status: 'world-not-running' }, args, 20_000)).toEqual({
      kind: 'retry', delay: 60_000, arrivalGraceStartedAt: undefined, lastAttemptAt: 20_000,
      pauseRetryCount: 1,
    });
  });

  test('moves established arrival windows by actual delayed pause time', () => {
    expect(nextActivitySettlementAttempt(
      { status: 'world-not-running' },
      {
        ...args,
        arrivalGraceStartedAt: 20_000,
        arrivalRecoveryDeadline: 320_000,
        lastAttemptAt: 20_000,
      } as RetryArgs,
      100_000,
    )).toEqual({
      kind: 'retry',
      delay: 60_000,
      arrivalGraceStartedAt: 100_000,
      arrivalRecoveryDeadline: 400_000,
      lastAttemptAt: 100_000,
      pauseRetryCount: 1,
    });
    const unboundedPauseArgs = {
      ...args,
      arrivalGraceStartedAt: 20_000,
      lastAttemptAt: 20_000,
    };
    expect(nextActivitySettlementAttempt(
      { status: 'world-not-running' },
      unboundedPauseArgs,
      100_000,
    )).toEqual({
      kind: 'retry',
      delay: 60_000,
      arrivalGraceStartedAt: 100_000,
      lastAttemptAt: 100_000,
      pauseRetryCount: 1,
    });
  });

  test('preserves the eight-second and five-minute windows across repeated pauses', () => {
    const firstPause = nextActivitySettlementAttempt(
      { status: 'world-not-running' },
      {
        ...args,
        arrivalGraceStartedAt: 20_000,
        arrivalRecoveryDeadline: 320_000,
        lastAttemptAt: 20_000,
      } as RetryArgs,
      100_000,
    );
    expect(firstPause).toEqual({
      kind: 'retry',
      delay: 60_000,
      arrivalGraceStartedAt: 100_000,
      arrivalRecoveryDeadline: 400_000,
      lastAttemptAt: 100_000,
      pauseRetryCount: 1,
    });
    expect(nextActivitySettlementAttempt(
      { status: 'world-not-running' },
      {
        ...args,
        arrivalGraceStartedAt: 100_000,
        arrivalRecoveryDeadline: 400_000,
        lastAttemptAt: 100_000,
        pauseRetryCount: 1,
      } as RetryArgs,
      260_000,
    )).toEqual({
      kind: 'retry',
      delay: 300_000,
      arrivalGraceStartedAt: 260_000,
      arrivalRecoveryDeadline: 560_000,
      lastAttemptAt: 260_000,
      pauseRetryCount: 2,
    });
  });

  test('bounds the long-pause retry chain with exponential backoff', () => {
    const delays = [60_000, 300_000, 1_800_000, 3_600_000];
    let retryArgs: RetryArgs = {
      ...args,
      arrivalGraceStartedAt: 20_000,
      arrivalRecoveryDeadline: 320_000,
      lastAttemptAt: 20_000,
      pauseRetryCount: 0,
    } as RetryArgs;
    let currentNow = 100_000;
    for (const [index, delay] of delays.entries()) {
      const next = nextActivitySettlementAttempt(
        { status: 'world-not-running' }, retryArgs, currentNow,
      );
      expect(next).toEqual(expect.objectContaining({
        kind: 'retry',
        delay,
        pauseRetryCount: index + 1,
        lastAttemptAt: currentNow,
      }));
      retryArgs = {
        ...retryArgs,
        ...next,
      } as RetryArgs;
      currentNow += delay;
    }
    expect(nextActivitySettlementAttempt(
      { status: 'world-not-running' }, retryArgs, currentNow,
    )).toEqual({
      kind: 'paused-outstanding',
      arrivalGraceStartedAt: retryArgs.arrivalGraceStartedAt! + 3_600_000,
      arrivalRecoveryDeadline: retryArgs.arrivalRecoveryDeadline! + 3_600_000,
      lastAttemptAt: currentNow,
      pauseRetryCount: 4,
    });
  });

  test('early callbacks wait for the remaining completion time', () => {
    expect(nextActivitySettlementAttempt({ status: 'activity-not-complete' }, args, 7_500)).toEqual({
      kind: 'retry', delay: 2_500, arrivalGraceStartedAt: undefined, lastAttemptAt: 7_500,
      pauseRetryCount: 0,
    });
  });

  test('arrival gets eight running seconds then requests a terminal failure', () => {
    expect(nextActivitySettlementAttempt({ status: 'destination-not-reached' }, args, 20_000))
      .toEqual({
        kind: 'retry', delay: 2_000, arrivalGraceStartedAt: 20_000, lastAttemptAt: 20_000,
        pauseRetryCount: 0,
      });
    expect(nextActivitySettlementAttempt(
      { status: 'destination-not-reached' },
      { ...args, arrivalGraceStartedAt: 20_000 },
      26_000,
    )).toEqual({
      kind: 'retry', delay: 2_000, arrivalGraceStartedAt: 20_000, lastAttemptAt: 26_000,
      pauseRetryCount: 0,
    });
    expect(nextActivitySettlementAttempt(
      { status: 'destination-not-reached' },
      { ...args, arrivalGraceStartedAt: 20_000 },
      28_001,
    )).toEqual({ kind: 'terminal-failure' });
  });

  test('long-distance movement toward the trusted landmark keeps a bounded recovery window', () => {
    expect(nextActivitySettlementAttempt(
      { status: 'destination-not-reached', destinationProgressing: true },
      { ...args, arrivalGraceStartedAt: 20_000 },
      100_000,
    )).toEqual({
      kind: 'retry',
      delay: 2_000,
      arrivalGraceStartedAt: 20_000,
      arrivalRecoveryDeadline: 400_000,
      lastAttemptAt: 100_000,
      pauseRetryCount: 0,
    });
    expect(nextActivitySettlementAttempt(
      { status: 'destination-not-reached', destinationProgressing: false },
      {
        ...args,
        arrivalGraceStartedAt: 20_000,
        arrivalRecoveryDeadline: 400_000,
      },
      400_001,
    )).toEqual({ kind: 'terminal-failure' });
  });

  test('locks a bounded recovery deadline across a temporary pathfinding reset', () => {
    const progressing = nextActivitySettlementAttempt(
      { status: 'destination-not-reached', destinationProgressing: true },
      { ...args, arrivalGraceStartedAt: 20_000 },
      30_000,
    );
    expect(progressing).toEqual({
      kind: 'retry',
      delay: 2_000,
      arrivalGraceStartedAt: 20_000,
      arrivalRecoveryDeadline: 330_000,
      lastAttemptAt: 30_000,
      pauseRetryCount: 0,
    });
    expect(nextActivitySettlementAttempt(
      { status: 'destination-not-reached', destinationProgressing: false },
      {
        ...args,
        arrivalGraceStartedAt: 20_000,
        arrivalRecoveryDeadline: 330_000,
      },
      40_000,
    )).toEqual({
      kind: 'retry',
      delay: 2_000,
      arrivalGraceStartedAt: 20_000,
      arrivalRecoveryDeadline: 330_000,
      lastAttemptAt: 40_000,
      pauseRetryCount: 0,
    });
    expect(nextActivitySettlementAttempt(
      { status: 'destination-not-reached', destinationProgressing: false },
      {
        ...args,
        arrivalGraceStartedAt: 20_000,
        arrivalRecoveryDeadline: 330_000,
      },
      330_001,
    )).toEqual({ kind: 'terminal-failure' });
  });

  test('settled and rejected outcomes are never retried', () => {
    expect(nextActivitySettlementAttempt({ status: 'settled' }, args, 20_000)).toBeUndefined();
    expect(nextActivitySettlementAttempt({ status: 'rejected' }, args, 20_000)).toBeUndefined();
  });
});
