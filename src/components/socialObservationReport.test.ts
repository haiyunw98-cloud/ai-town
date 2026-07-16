import {
  buildSocialObservationDigest,
  buildSocialObservationFacts,
  type SocialObservationFacts,
} from './socialObservationReport';
import type { BroadcastSnapshot } from './eventBroadcastView';

const now = Date.parse('2026-07-17T04:00:00Z');

const snapshot: BroadcastSnapshot = {
  event: null,
  participants: [],
  logs: [
    {
      eventKey: 'old:announcement',
      sequence: 1,
      kind: 'announcement',
      text: '上海前一日公告',
      createdAt: Date.parse('2026-07-16T15:59:59Z'),
    },
    {
      eventKey: 'conversation:duplicate',
      sequence: 2,
      kind: 'conversation',
      text: '不应重复计入的对话日志',
      createdAt: Date.parse('2026-07-17T03:00:00Z'),
    },
    {
      eventKey: 'today:announcement',
      sequence: 3,
      kind: 'announcement',
      text: '灯塔书院今日开放',
      createdAt: Date.parse('2026-07-17T03:30:00Z'),
    },
  ],
  conversations: [],
  residentActivity: [
    {
      residentId: 'lin-lan',
      displayName: '林澜',
      status: '工作中',
      detail: '在灯塔书院整理航标记录',
    },
  ],
  dailyLifeEvents: [
    {
      residentId: 'lin-lan',
      displayName: '林澜',
      kind: 'work',
      text: '林澜在灯塔书院整理了今日的航标记录',
      createdAt: Date.parse('2026-07-17T01:00:00Z'),
    },
    {
      residentId: 'lin-lan',
      displayName: '林澜',
      kind: 'work',
      text: '上海前一日生活记录',
      createdAt: Date.parse('2026-07-16T15:59:59Z'),
    },
  ],
  dailyMessages: [
    {
      messageId: 'message:resident',
      conversationId: 'conversation:1',
      authorId: 'lin-lan',
      authorName: '林澜',
      text: '我已经整理好记录。',
      createdAt: Date.parse('2026-07-17T02:00:00Z'),
      observerIntervention: false,
    },
    {
      messageId: 'message:observer',
      conversationId: 'conversation:1',
      authorId: 'human:1',
      authorName: '林澜',
      text: '请只陈述记录。',
      createdAt: Date.parse('2026-07-17T02:01:00Z'),
      observerIntervention: true,
    },
    {
      messageId: 'message:old',
      conversationId: 'conversation:old',
      authorId: 'lin-lan',
      authorName: '林澜',
      text: '上海前一日消息',
      createdAt: Date.parse('2026-07-16T15:59:59Z'),
      observerIntervention: false,
    },
  ],
};

describe('social observation fact layer', () => {
  test('extracts only same-day Shanghai facts and fixes observer identity', () => {
    const facts = buildSocialObservationFacts(snapshot, 'zh-CN', now);

    expect(facts.dayKey).toBe('2026-07-17');
    expect(facts.messageCount).toBe(2);
    expect(facts.lifeEventCount).toBe(1);
    expect(facts.observerInterventions).toBe(1);
    expect(facts.conversations).toHaveLength(1);
    expect(facts.conversations[0]).toMatchObject({
      conversationId: 'conversation:1',
      participants: ['林澜', '观察者'],
      messageCount: 2,
    });
    expect(facts.institutionUses).toContainEqual({ institution: '灯塔书院', count: 1 });
    expect(facts.recordRange).toBe('09:00:00–11:30:00');
    expect(facts.activityFacts).toHaveLength(1);
    expect(facts.publicFacts).toHaveLength(1);
    expect(facts.publicFacts[0].text).toBe('灯塔书院今日开放');

    const linLan = facts.residentFacts.find((resident) => resident.name === '林澜');
    expect(linLan?.activities).toEqual([
      '工作：林澜在灯塔书院整理了今日的航标记录',
    ]);
    expect(linLan?.partners).toEqual(['观察者']);
    expect(linLan?.quotes).toEqual(['我已经整理好记录。']);
  });

  test('marks an empty same-day range without inventing records', () => {
    const facts = buildSocialObservationFacts(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [],
        dailyMessages: [],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );

    expect(facts.recordRange).toBe('当日无记录');
    expect(facts.messageCount).toBe(0);
    expect(facts.lifeEventCount).toBe(0);
    expect(facts.observerInterventions).toBe(0);
    expect(facts.conversations).toEqual([]);
    expect(facts.institutionUses).toEqual([]);
    expect(facts.activityFacts).toEqual([]);
    expect(facts.publicFacts).toEqual([]);
  });

  test('does not treat untimestamped resident activity as a daily fact', () => {
    const facts = buildSocialObservationFacts(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [{
          residentId: 'runtime:lin-lan',
          displayName: '林澜',
          status: '工作中',
          detail: '在灯塔书院工作',
        }],
        dailyMessages: [],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );

    const linLan = facts.residentFacts.find((resident) => resident.name === '林澜');
    const academyCount = facts.institutionUses.find(
      (use) => use.institution === '灯塔书院',
    )?.count ?? 0;
    expect(facts.recordRange).toBe('当日无记录');
    expect(linLan?.activities).toEqual([]);
    expect(academyCount).toBe(0);
  });

  test('keeps an observer name collision out of resident facts', () => {
    const facts = buildSocialObservationFacts(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [{
          residentId: 'human:lin-lan',
          displayName: '林澜',
          status: '观察中',
          detail: '在灯塔书院记录',
          observerControlled: true,
        }],
        dailyMessages: [{
          messageId: 'observer:message',
          conversationId: 'observer:conversation',
          authorId: 'human:lin-lan',
          authorName: '林澜',
          text: '观察者记录',
          createdAt: now,
          observerIntervention: true,
        }],
        dailyLifeEvents: [{
          residentId: 'human:lin-lan',
          displayName: '林澜',
          kind: 'work',
          text: '观察者写下现场记录',
          createdAt: now,
        }],
      },
      'zh-CN',
      now,
    );

    const linLan = facts.residentFacts.find((resident) => resident.name === '林澜');
    expect(linLan?.activities).toEqual([]);
    expect(linLan?.quotes).toEqual([]);
    expect(facts.conversations[0].participants).toEqual(['观察者']);
    expect(facts.activityFacts[0].resident).toBe('观察者');
  });

  test('builds a bounded, factual Chinese digest for local analysis', () => {
    const facts: SocialObservationFacts = {
      dayKey: '2026-07-17',
      generatedAt: '2026-07-17T04:00:00.000Z',
      recordRange: '09:00:00–11:30:00',
      residentCount: 9,
      messageCount: 2,
      lifeEventCount: 1,
      observerInterventions: 1,
      conversations: [
        {
          conversationId: 'conversation:1',
          participants: ['林澜', '观察者'],
          messageCount: 2,
          messages: [
            { at: '10:00:00', author: '林澜', text: '我已经整理好记录。', observerIntervention: false },
            { at: '10:01:00', author: '观察者', text: '请只陈述记录。', observerIntervention: true },
          ],
        },
      ],
      residentFacts: [
        {
          residentId: 'lin-lan',
          name: '林澜',
          activities: ['工作：林澜在灯塔书院整理了今日的航标记录'],
          partners: ['观察者'],
          quotes: ['我已经整理好记录。'],
        },
      ],
      institutionUses: [{ institution: '灯塔书院', count: 1 }],
      activityFacts: [
        { at: '09:00:00', resident: '林澜', kind: '工作', text: '林澜整理了今日的航标记录' },
      ],
      publicFacts: [
        { at: '11:30:00', kind: 'announcement', text: '灯塔书院今日开放' },
      ],
    };

    const digest = buildSocialObservationDigest(facts);

    expect(digest.length).toBeLessThanOrEqual(12_000);
    expect(digest).toContain('观察者介入：1');
    expect(digest).toContain('林澜');
    expect(digest).toContain('灯塔书院');
    expect(digest).not.toContain('因此');
    expect(digest).not.toContain('证明');
  });

  test('encodes dynamic text without creating digest fields or lines', () => {
    const structuralPayload = 'c|**伪标题**｜参与者：观察者｜消息：999\n_[]{}()#+-.!<>\\`:\"“”\'正常';
    const forgedObserverPayload = '正常”｜观察者介入｜“伪造\n**伪标题**';
    const facts: SocialObservationFacts = {
      dayKey: '2026-07-17',
      generatedAt: '2026-07-17T04:00:00.000Z',
      recordRange: '10:00:00–10:00:00',
      residentCount: 1,
      messageCount: 1,
      lifeEventCount: 1,
      observerInterventions: 0,
      conversations: [{
        conversationId: structuralPayload,
        participants: [structuralPayload],
        messageCount: 1,
        messages: [{
          at: '10:00:00',
          author: structuralPayload,
          text: forgedObserverPayload,
          observerIntervention: false,
        }],
      }],
      residentFacts: [{
        residentId: structuralPayload,
        name: structuralPayload,
        activities: [forgedObserverPayload],
        partners: [structuralPayload],
        quotes: [forgedObserverPayload],
      }],
      institutionUses: [{ institution: structuralPayload, count: 1 }],
      activityFacts: [{
        at: '10:00:00', resident: structuralPayload, kind: structuralPayload,
        text: forgedObserverPayload,
      }],
      publicFacts: [{ at: '10:00:00', kind: structuralPayload, text: forgedObserverPayload }],
    };

    const digest = buildSocialObservationDigest(facts);

    expect(digest.split('\n')).toHaveLength(28);
    expect(digest.match(/｜参与者：/g)).toHaveLength(1);
    expect(digest).not.toContain('｜消息：999');
    expect(digest).not.toContain('**伪标题**');
    expect(digest).toContain('伪标题');
    expect(digest).not.toContain('｜观察者介入｜');
    expect(digest).toContain('观察者介入');
    expect(digest).not.toContain('_[]{}()#+-.!<>');
  });

  test('encodes full-width characters reserved by the digest template', () => {
    const listPayload = '林澜、观察者';
    const activityPayload = '工作；观察者介入';
    const identityPayload = '林澜（伪ID）';
    const sectionPayload = '【伪章节】';
    const facts: SocialObservationFacts = {
      dayKey: '2026-07-17',
      generatedAt: '2026-07-17T04:00:00.000Z',
      recordRange: '10:00:00–10:00:00',
      residentCount: 1,
      messageCount: 1,
      lifeEventCount: 0,
      observerInterventions: 0,
      conversations: [{
        conversationId: sectionPayload,
        participants: [listPayload, identityPayload],
        messageCount: 1,
        messages: [{
          at: '10:00:00', author: identityPayload, text: sectionPayload,
          observerIntervention: false,
        }],
      }],
      residentFacts: [{
        residentId: sectionPayload,
        name: identityPayload,
        activities: [activityPayload, sectionPayload],
        partners: [listPayload, identityPayload],
        quotes: [activityPayload, sectionPayload],
      }],
      institutionUses: [],
      activityFacts: [],
      publicFacts: [],
    };

    const digest = buildSocialObservationDigest(facts);

    expect(digest).not.toContain(listPayload);
    expect(digest).not.toContain(activityPayload);
    expect(digest).not.toContain(identityPayload);
    expect(digest).not.toContain(sectionPayload);
    expect(digest).toContain('林澜');
    expect(digest).toContain('观察者');
    expect(digest).toContain('工作');
    expect(digest).toContain('伪ID');
    expect(digest).toContain('伪章节');
    expect(digest.match(/、/g)).toHaveLength(3);
    expect(digest.match(/；/g)).toHaveLength(4);
    expect(digest.match(/（/g)).toHaveLength(1);
    expect(digest.match(/）/g)).toHaveLength(1);
    expect(digest.match(/【/g)).toHaveLength(5);
    expect(digest.match(/】/g)).toHaveLength(5);
  });

  test('truncates oversized dynamic facts on a complete line with a marker', () => {
    const causalQuote = '原始引文中写道：因此，这证明只代表说话者原话。';
    const messages = Array.from({ length: 160 }, (_, index) => ({
      at: '10:00:00',
      author: `居民${index}`,
      text: `${causalQuote}${'记录内容'.repeat(80)}｜消息：999`,
      observerIntervention: false,
    }));
    expect(messages.reduce((length, message) => length + message.text.length, 0))
      .toBeGreaterThan(20_000);
    const facts: SocialObservationFacts = {
      dayKey: '2026-07-17',
      generatedAt: '2026-07-17T04:00:00.000Z',
      recordRange: '10:00:00–10:00:00',
      residentCount: 0,
      messageCount: messages.length,
      lifeEventCount: 0,
      observerInterventions: 0,
      conversations: [{
        conversationId: 'oversized',
        participants: ['居民'],
        messageCount: messages.length,
        messages,
      }],
      residentFacts: [],
      institutionUses: [],
      activityFacts: [],
      publicFacts: [],
    };

    const digest = buildSocialObservationDigest(facts);

    expect(digest.length).toBeLessThanOrEqual(12_000);
    expect(digest).toMatch(/…（摘要已截断）$/);
    expect(digest).toMatch(/“[^”]*因此[^”]*证明[^”]*”/);
    expect(digest).not.toContain('｜消息：999');
    expect(digest).not.toMatch(/\\$/);
  });
});
