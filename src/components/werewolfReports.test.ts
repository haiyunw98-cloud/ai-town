import { buildDailyReport, type BroadcastSnapshot } from './eventBroadcastView';
import {
  buildSocialObservationFacts,
  buildSocialObservationReport,
} from './socialObservationReport';

const now = Date.parse('2026-08-06T08:00:00.000Z');
const snapshot: BroadcastSnapshot = {
  event: null,
  participants: [],
  logs: [],
  conversations: [],
  residentActivity: [],
  dailyMessages: [],
  werewolf: {
    sessionId: 'session:1',
    status: 'completed',
    phase: 'completed',
    round: 2,
    mode: 'observe',
    winner: 'good',
    startedAt: now - 60_000,
    endedAt: now,
    seats: [],
    truncated: false,
    actions: [
      {
        actionKey: 'session:1:1:day-speaking:p:1', sequence: 2, round: 1,
        phase: 'day-speaking', actorId: 'p:1', actorName: '林澜', kind: 'speech',
        text: '我会结合前后说法和票型判断。', source: 'model', createdAt: now - 40_000,
      },
      {
        actionKey: 'session:1:1:day-voting:p:1', sequence: 3, round: 1,
        phase: 'day-voting', actorId: 'p:1', actorName: '林澜', kind: 'day-vote',
        targetId: 'p:2', targetName: '顾潮', source: 'model', createdAt: now - 30_000,
      },
    ],
  },
};

describe('werewolf daily reports', () => {
  test('factual journal preserves rounds, public votes, and the real winner', () => {
    const report = buildDailyReport(snapshot, 'zh-CN', now);
    expect(report).toContain('狼人杀第 2 轮');
    expect(report).toContain('公开投票：林澜 → 顾潮');
    expect(report).toContain('好人阵营获胜');
    expect(report).toContain('session:1:1:day\\-voting:p:1');
  });

  test('social report cites public evidence without inventing hidden knowledge', () => {
    const facts = buildSocialObservationFacts(snapshot, 'zh-CN', now);
    const report = buildSocialObservationReport(facts, { source: 'fallback', narrative: '' });
    expect(report).toContain('证据 session:1:1:day-voting:p:1');
    expect(report).not.toContain('居民当时已经知道全部狼人');
  });
});
