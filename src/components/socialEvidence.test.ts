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

function evidenceFor(
  snapshot: BroadcastSnapshot,
  category: ReturnType<typeof buildSocialEvidence>['evidence'][number]['category'],
) {
  const evidence = buildSocialEvidence(snapshot, now).evidence.find(
    (entry) => entry.category === category,
  );
  if (!evidence) throw new Error(`Missing evidence category: ${category}`);
  return evidence;
}

function residentMessage(
  index: number,
  authorId: string,
  conversationId = 'conversation:network',
): BroadcastSnapshot['dailyMessages'][number] {
  return {
    messageId: `network:${index}`,
    conversationId,
    authorId,
    authorName: authorId,
    text: `普通消息 ${index}`,
    createdAt: Date.parse('2026-07-17T02:00:00Z') + index,
    observerIntervention: false,
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
      'message:message:tea:1#001',
      'life:1784250000000:tang-guo:work#001',
      'log:market:opening#1#001',
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

  test('weights a two-resident pair by all resident turns instead of one conversation', () => {
    const messages = [
      ...Array.from({ length: 100 }, (_, index) => residentMessage(index, 'resident:a')),
      residentMessage(100, 'resident:b'),
    ];
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      residentActivity: [
        { residentId: 'resident:a', displayName: '甲', status: '', detail: '' },
        { residentId: 'resident:b', displayName: '乙', status: '', detail: '' },
      ],
      dailyMessages: messages,
      dailyLifeEvents: [],
      logs: [],
    });

    expect(evidenceFor(snapshot, 'interaction-network').statement).toMatch(
      /居民互动对 1 组.*互动回合 101 条.*互动集中度 100%/u,
    );
  });

  test('uses only adjacent cross-speaker turns for a multi-resident conversation', () => {
    const authors = ['resident:a', 'resident:a', 'resident:b', 'resident:c', 'resident:c', 'resident:a'];
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      residentActivity: authors.slice(0, 3).map((residentId) => ({
        residentId,
        displayName: residentId,
        status: '',
        detail: '',
      })),
      dailyMessages: authors.map((authorId, index) => residentMessage(index, authorId)),
      dailyLifeEvents: [],
      logs: [],
    });

    expect(evidenceFor(snapshot, 'interaction-network').statement).toMatch(
      /居民互动对 3 组.*互动回合 3 条.*互动集中度 33%/u,
    );
  });

  test('ignores stale participant names and observer name collisions when creating pairs', () => {
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [{
        conversationId: 'conversation:network',
        participantNames: ['甲', '乙', '过期居民'],
        summary: '',
        updatedAt: Date.parse('2026-07-17T02:10:00Z'),
        messages: [],
      }],
      residentActivity: [
        { residentId: 'resident:a', displayName: '甲', status: '', detail: '' },
        { residentId: 'resident:b', displayName: '乙', status: '', detail: '' },
        { residentId: 'resident:stale', displayName: '过期居民', status: '', detail: '' },
      ],
      dailyMessages: [
        residentMessage(0, 'resident:a'),
        {
          ...residentMessage(1, 'human:1'),
          authorName: '甲',
          observerIntervention: true,
        },
        residentMessage(2, 'resident:b'),
      ],
      dailyLifeEvents: [],
      logs: [],
    });

    expect(evidenceFor(snapshot, 'interaction-network').statement).toMatch(
      /居民互动对 1 组.*互动回合 2 条.*未记录到居民间互动 1 人/u,
    );
  });

  test('assigns distinct deterministic audit keys to colliding life records', () => {
    const shared = {
      residentId: 'resident:a',
      displayName: '甲',
      kind: 'work',
      createdAt: Date.parse('2026-07-17T01:00:00Z'),
    };
    const lifeEvents: NonNullable<BroadcastSnapshot['dailyLifeEvents']> = [
      { ...shared, text: '在听雨茶庄整理甲订单。' },
      { ...shared, text: '在听雨茶庄整理乙订单。' },
      { ...shared, text: '在听雨茶庄整理乙订单。' },
    ];
    const snapshot = fixtureBroadcastSnapshot({
      dailyLifeEvents: lifeEvents,
      dailyMessages: [],
      logs: [],
    });
    const reversed = fixtureBroadcastSnapshot({
      dailyLifeEvents: [...lifeEvents].reverse(),
      dailyMessages: [],
      logs: [],
    });
    const keys = evidenceFor(snapshot, 'activity-distribution').sourceKeys;

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((key) => /#\d{3}$/u.test(key))).toBe(true);
    expect(buildSocialEvidence(reversed, now)).toEqual(buildSocialEvidence(snapshot, now));
  });

  test('disambiguates duplicate message ids without losing source records', () => {
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      dailyMessages: [
        { ...residentMessage(0, 'resident:a'), messageId: 'duplicate' },
        { ...residentMessage(1, 'resident:b'), messageId: 'duplicate' },
      ],
      dailyLifeEvents: [],
      logs: [],
    });
    const sourceKeys = buildSocialEvidence(snapshot, now).evidence
      .flatMap((entry) => entry.sourceKeys)
      .filter((key) => key.startsWith('message:duplicate#'));

    expect(new Set(sourceKeys)).toEqual(new Set([
      'message:duplicate#001',
      'message:duplicate#002',
    ]));
  });

  test('shares legacy policy while retaining ordinary archive work and mixed daily clauses', () => {
    const messages: BroadcastSnapshot['dailyMessages'] = [
      { ...residentMessage(0, 'resident:a'), text: '灯塔谜团与异常闪光。' },
      { ...residentMessage(1, 'resident:b'), text: '往届百万金贝寻宝比赛。' },
      { ...residentMessage(2, 'resident:a'), text: 'An anomaly appeared during navigation at sea.' },
      { ...residentMessage(3, 'resident:b'), text: '整理普通历史记录并完成合作。' },
      { ...residentMessage(4, 'resident:a'), text: '把旧档案入库后继续工作。' },
      {
        ...residentMessage(5, 'resident:b'),
        text: '今天一起核对订单。随后聊起灯塔谜团与异常闪光。然后完成结算。',
      },
    ];
    const result = buildSocialEvidence(fixtureBroadcastSnapshot({
      conversations: [],
      dailyMessages: messages,
      dailyLifeEvents: [],
      logs: [],
    }), now);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/灯塔谜团|异常闪光|百万金贝|navigation at sea/iu);
    expect(serialized).toContain('message:network:3#001');
    expect(serialized).toContain('message:network:4#001');
    expect(serialized).toContain('message:network:5#001');
    expect(evidenceFor(fixtureBroadcastSnapshot({
      conversations: [],
      dailyMessages: messages,
      dailyLifeEvents: [],
      logs: [],
    }), 'relationship-signal').statement).toMatch(/合作 2 条.*交易 1 条/u);
  });

  test('counts only explicit completed institution use without negated or planned mentions', () => {
    const lifeEvents: NonNullable<BroadcastSnapshot['dailyLifeEvents']> = [
      {
        residentId: 'resident:a', displayName: '甲', kind: 'travel',
        text: '没有去晨雾集市。', createdAt: Date.parse('2026-07-17T01:00:00Z'),
      },
      {
        residentId: 'resident:a', displayName: '甲', kind: 'travel',
        text: '打算明天去晨雾集市。', createdAt: Date.parse('2026-07-17T01:01:00Z'),
      },
      {
        residentId: 'resident:a', displayName: '甲', kind: 'social',
        text: '“晨雾集市”比别处热闹。', createdAt: Date.parse('2026-07-17T01:02:00Z'),
      },
      {
        residentId: 'resident:a', displayName: '甲', kind: 'work',
        text: '甲在听雨茶庄整理订单。', createdAt: Date.parse('2026-07-17T01:03:00Z'),
      },
    ];
    const institution = evidenceFor(fixtureBroadcastSnapshot({
      dailyLifeEvents: lifeEvents,
      dailyMessages: [],
      logs: [],
    }), 'institution-use');

    expect(institution.statement).toMatch(/听雨茶庄 1 次/u);
    expect(institution.statement).not.toMatch(/晨雾集市 [1-9]\d* 次/u);
    expect(institution.sourceKeys).toHaveLength(1);
  });

  test('counts explicit friendship and intimacy while rejecting negated relationship signals', () => {
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      dailyMessages: [
        { ...residentMessage(0, 'resident:a'), text: '我们是朋友，也约会了。' },
        { ...residentMessage(1, 'resident:b'), text: '没有合作，也没有交易。' },
        { ...residentMessage(2, 'resident:a'), text: '我们一起照顾邻居。' },
      ],
      dailyLifeEvents: [],
      logs: [],
    });

    expect(evidenceFor(snapshot, 'relationship-signal').statement).toMatch(
      /友情 1 条.*亲密 1 条.*合作 1 条.*照护 1 条.*交易 0 条.*分歧 0 条/u,
    );
  });

  test('reports distinct visible activity before and after observer intervention', () => {
    const observerAt = Date.parse('2026-07-17T02:00:00Z');
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      dailyMessages: [
        { ...residentMessage(0, 'resident:a'), createdAt: observerAt - 60_000 },
        {
          ...residentMessage(1, 'human:1'),
          createdAt: observerAt,
          observerIntervention: true,
          authorName: '观察者',
        },
      ],
      dailyLifeEvents: [
        {
          residentId: 'resident:a', displayName: '甲', kind: 'work', text: '完成普通工作。',
          createdAt: observerAt - 10 * 60_000,
        },
        {
          residentId: 'resident:b', displayName: '乙', kind: 'rest', text: '完成休息记录。',
          createdAt: observerAt + 60_000,
        },
      ],
      logs: [{
        eventKey: 'after', sequence: 1, kind: 'announcement', text: '社区活动完成。',
        createdAt: observerAt + 2 * 60_000,
      }],
    });
    const observer = evidenceFor(snapshot, 'observer-intervention');

    expect(observer.statement).toMatch(
      /观察者消息 1 条.*介入前 30 分钟可见活动 2 条.*介入后 30 分钟可见活动 2 条.*差值 0 条/u,
    );
    expect(observer.limitations.join('')).toMatch(/不能|不足/u);
    expect(observer.sourceKeys).toHaveLength(5);
  });

  test('states public-event and ordinary-life counts with complementary proportions', () => {
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      dailyMessages: [residentMessage(0, 'resident:a')],
      dailyLifeEvents: [
        {
          residentId: 'resident:a', displayName: '甲', kind: 'event', text: '社区活动完成。',
          createdAt: Date.parse('2026-07-17T01:00:00Z'),
        },
        {
          residentId: 'resident:b', displayName: '乙', kind: 'work', text: '普通工作完成。',
          createdAt: Date.parse('2026-07-17T01:10:00Z'),
        },
      ],
      logs: [{
        eventKey: 'public', sequence: 1, kind: 'announcement', text: '公共公告发布。',
        createdAt: Date.parse('2026-07-17T01:20:00Z'),
      }],
    });

    expect(evidenceFor(snapshot, 'public-life').statement).toMatch(
      /公共事件 2 条（50%）.*普通生活 2 条（50%）/u,
    );
  });

  test('does not award high confidence for many repeated hits with narrow coverage', () => {
    const messages = [
      ...Array.from({ length: 100 }, (_, index) => residentMessage(index, 'resident:a')),
      residentMessage(100, 'resident:b'),
    ];
    const snapshot = fixtureBroadcastSnapshot({
      conversations: [],
      residentActivity: [
        { residentId: 'resident:a', displayName: '甲', status: '', detail: '' },
        { residentId: 'resident:b', displayName: '乙', status: '', detail: '' },
      ],
      dailyMessages: messages,
      dailyLifeEvents: [],
      logs: [],
    });

    expect(evidenceFor(snapshot, 'interaction-network').confidence).toBe('中');
    expect(buildSocialEvidence(snapshot, now).methodNotes.join('')).toMatch(
      /不同居民|不同来源|时间跨度|类别/u,
    );
  });

  test('uses traceable coverage evidence and cautious findings for an empty day', () => {
    const snapshot = fixtureBroadcastSnapshot({
      participants: [],
      conversations: [],
      residentActivity: [],
      dailyMessages: [],
      dailyLifeEvents: [],
      logs: [],
    });
    const result = buildSocialEvidence(snapshot, now);
    const evidenceById = new Map(result.evidence.map((entry) => [entry.evidenceId, entry]));

    expect(result.evidence).toHaveLength(6);
    expect(result.ruleFindings).toHaveLength(3);
    expect(new Set(result.ruleFindings.map((finding) => finding.evidenceIds[0])).size).toBe(3);
    expect(result.ruleFindings.every((finding) => /未记录|没有|无可用/u.test(finding.claim))).toBe(true);
    expect(result.ruleFindings.every((finding) => finding.confidence === '低')).toBe(true);
    expect(result.ruleFindings.every((finding) => finding.evidenceIds.every(
      (evidenceId) => (evidenceById.get(evidenceId)?.sourceKeys.length ?? 0) > 0,
    ))).toBe(true);
    expect(result.ruleFindings.flatMap((finding) => finding.evidenceIds).every(
      (evidenceId) => evidenceById.get(evidenceId)?.sourceKeys.includes('snapshot-day:2026-07-17'),
    )).toBe(true);
  });

  test('ranks narrow observed evidence ahead of synthetic absence coverage', () => {
    const result = buildSocialEvidence(fixtureBroadcastSnapshot({
      participants: [],
      conversations: [],
      residentActivity: [],
      dailyMessages: [residentMessage(0, 'resident:a')],
      dailyLifeEvents: [],
      logs: [],
    }), now);
    const evidenceById = new Map(result.evidence.map((entry) => [entry.evidenceId, entry]));
    const firstTwo = result.ruleFindings.slice(0, 2).map(
      (finding) => evidenceById.get(finding.evidenceIds[0])!,
    );

    expect(firstTwo.every((evidence) =>
      !evidence.sourceKeys.includes('snapshot-day:2026-07-17'),
    )).toBe(true);
  });
});
