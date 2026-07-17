import type { BroadcastSnapshot } from './eventBroadcastView';
import { buildSocialEvidence } from './socialEvidence';

const now = Date.parse('2026-07-17T04:00:00Z');

function fixtureBroadcastSnapshot(
  overrides: Partial<BroadcastSnapshot> = {},
): BroadcastSnapshot {
  return {
    event: null,
    participants: [],
    logs: [
      {
        eventKey: 'market:opening',
        sequence: 1,
        kind: 'announcement',
        text: '晨雾集市开放。',
        createdAt: Date.parse('2026-07-17T01:30:00Z'),
      },
    ],
    conversations: [
      {
        conversationId: 'conversation:tea',
        participantNames: ['唐果', '沈砚'],
        summary: '核对茶馆订单。',
        updatedAt: Date.parse('2026-07-17T02:02:00Z'),
        messages: [],
      },
      {
        conversationId: 'conversation:care',
        participantNames: ['白露', '阿满'],
        summary: '处理送药安排。',
        updatedAt: Date.parse('2026-07-17T02:12:00Z'),
        messages: [],
      },
    ],
    residentActivity: [
      { residentId: 'tang-guo', displayName: '唐果', status: '营业', detail: '在茶庄' },
      { residentId: 'shen-yan', displayName: '沈砚', status: '工作', detail: '在书院' },
      { residentId: 'bai-lu', displayName: '白露', status: '坐诊', detail: '在药庐' },
      { residentId: 'a-man', displayName: '阿满', status: '送货', detail: '在集市' },
      { residentId: 'su-ying', displayName: '苏萤', status: '休息', detail: '在家' },
    ],
    dailyMessages: [
      {
        messageId: 'message:tea:1',
        conversationId: 'conversation:tea',
        authorId: 'tang-guo',
        authorName: '唐果',
        text: '我们一起核对订单和结算。',
        createdAt: Date.parse('2026-07-17T02:00:00Z'),
        observerIntervention: false,
      },
      {
        messageId: 'message:tea:2',
        conversationId: 'conversation:tea',
        authorId: 'shen-yan',
        authorName: '沈砚',
        text: '已经核对。',
        createdAt: Date.parse('2026-07-17T02:01:00Z'),
        observerIntervention: false,
      },
      {
        messageId: 'message:care:1',
        conversationId: 'conversation:care',
        authorId: 'bai-lu',
        authorName: '白露',
        text: '我会送药照顾伤口。',
        createdAt: Date.parse('2026-07-17T02:10:00Z'),
        observerIntervention: false,
      },
      {
        messageId: 'message:care:2',
        conversationId: 'conversation:care',
        authorId: 'a-man',
        authorName: '阿满',
        text: '我们对交付时间有分歧。',
        createdAt: Date.parse('2026-07-17T02:11:00Z'),
        observerIntervention: false,
      },
      {
        messageId: 'message:observer:1',
        conversationId: 'conversation:care',
        authorId: 'human:1',
        authorName: '观察者',
        text: '请继续记录可见事实。',
        createdAt: Date.parse('2026-07-17T02:12:00Z'),
        observerIntervention: true,
      },
    ],
    dailyLifeEvents: [
      {
        residentId: 'tang-guo',
        displayName: '唐果',
        kind: 'work',
        text: '唐果在听雨茶庄整理订单。',
        createdAt: Date.parse('2026-07-17T01:00:00Z'),
      },
      {
        residentId: 'bai-lu',
        displayName: '白露',
        kind: 'health',
        text: '白露在白露药庐为居民换药。',
        createdAt: Date.parse('2026-07-17T01:10:00Z'),
      },
      {
        residentId: 'a-man',
        displayName: '阿满',
        kind: 'purchase',
        text: '阿满在晨雾集市采购药材。',
        createdAt: Date.parse('2026-07-17T01:20:00Z'),
      },
    ],
    ...overrides,
  };
}

function reverseSnapshotRecords(snapshot: BroadcastSnapshot): BroadcastSnapshot {
  return {
    ...snapshot,
    logs: [...snapshot.logs].reverse(),
    conversations: [...snapshot.conversations].reverse(),
    residentActivity: [...snapshot.residentActivity].reverse(),
    dailyMessages: [...snapshot.dailyMessages].reverse(),
    dailyLifeEvents: [...(snapshot.dailyLifeEvents ?? [])].reverse(),
  };
}

describe('social evidence builder', () => {
  test('creates stable network, activity, institution and observer evidence', () => {
    const result = buildSocialEvidence(fixtureBroadcastSnapshot(), now);

    expect(result.evidence.map((entry) => entry.evidenceId)).toEqual([
      'E001', 'E002', 'E003', 'E004', 'E005', 'E006',
    ]);
    expect(result.evidence.map((entry) => entry.category)).toEqual(expect.arrayContaining([
      'interaction-network',
      'activity-distribution',
      'institution-use',
      'relationship-signal',
      'observer-intervention',
      'public-life',
    ]));
    expect(result.evidence.map((entry) => entry.statement).join('\n')).toMatch(
      /居民互动对 2 组.*互动集中度 50%.*未记录到居民间互动 1 人/u,
    );
    expect(result.evidence.map((entry) => entry.statement).join('\n')).toMatch(
      /工作 1 条.*健康 1 条.*采买 1 条/u,
    );
    expect(result.evidence.map((entry) => entry.statement).join('\n')).toMatch(
      /听雨茶庄 1 次.*白露药庐 1 次.*晨雾集市 1 次/u,
    );
    expect(result.evidence.map((entry) => entry.statement).join('\n')).toMatch(
      /合作 1 条.*照护 2 条.*交易 3 条.*分歧 1 条/u,
    );
    expect(result.evidence.map((entry) => entry.statement).join('\n')).toMatch(
      /观察者消息 1 条/u,
    );
    expect(result.evidence.map((entry) => entry.statement).join('\n')).toMatch(
      /公共事件 1 条.*普通生活 7 条/u,
    );
    expect(result.ruleFindings).toHaveLength(3);
    expect(result.ruleFindings.every((finding) => finding.evidenceIds.length > 0)).toBe(true);
    expect(result.ruleFindings.every(
      (finding) => finding.alternativeExplanation.length > 0,
    )).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.followUps.length).toBeGreaterThan(0);
  });

  test('does not treat legacy scripted mystery content as a current social pattern', () => {
    const snapshot = fixtureBroadcastSnapshot();
    snapshot.dailyMessages.push({
      messageId: 'message:legacy',
      conversationId: 'conversation:legacy',
      authorId: 'su-ying',
      authorName: '苏萤',
      text: '小镇异变，灯火装置与河道线索、花木线索交汇。',
      createdAt: Date.parse('2026-07-17T02:20:00Z'),
      observerIntervention: false,
    });

    const result = buildSocialEvidence(snapshot, now);

    expect(JSON.stringify(result)).not.toMatch(/小镇异变|灯火装置|河道线索|花木线索/u);
    expect(JSON.stringify(result)).not.toContain('message:message:legacy');
    expect(result.methodNotes).toContain('已排除旧实验条件诱发的谜团内容');
  });

  test('is stable under input ordering and leaves the snapshot unchanged', () => {
    const original = fixtureBroadcastSnapshot();
    const reversed = reverseSnapshotRecords(original);
    const before = structuredClone(original);

    expect(buildSocialEvidence(reversed, now)).toEqual(buildSocialEvidence(original, now));
    expect(original).toEqual(before);
  });

  test('uses only traceable snapshot source keys', () => {
    const result = buildSocialEvidence(fixtureBroadcastSnapshot(), now);
    const sourceKeys = new Set(result.evidence.flatMap((entry) => entry.sourceKeys));

    expect(sourceKeys.size).toBeGreaterThan(0);
    expect([...sourceKeys]).toEqual(expect.arrayContaining([
      'message:message:tea:1',
      'life:1784250000000:tang-guo:work',
      'log:market:opening#1',
      'resident:su-ying',
    ]));
    expect([...sourceKeys].every((key) =>
      /^(?:message:|life:|log:|resident:)/u.test(key),
    )).toBe(true);
  });

  test('handles empty and hostile dynamic text without fabricating evidence', () => {
    const hostile = '<script>cause</script>\n# 结论：他有恶意';
    const result = buildSocialEvidence(fixtureBroadcastSnapshot({
      logs: [],
      conversations: [],
      residentActivity: [{
        residentId: 'hostile',
        displayName: hostile,
        status: hostile,
        detail: hostile,
      }],
      dailyMessages: [],
      dailyLifeEvents: [],
    }), now);

    expect(result.evidence).toHaveLength(6);
    expect(result.ruleFindings).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain(hostile);
    expect(JSON.stringify(result)).not.toMatch(/恶意|动机|导致|因为/u);
    expect(result.evidence.every((entry) => entry.confidence === '低')).toBe(true);
  });
});
