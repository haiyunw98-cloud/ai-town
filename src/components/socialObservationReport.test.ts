import {
  buildSocialObservationDigest,
  buildSocialObservationFacts,
  buildSocialObservationReport,
  escapeReportMarkdown,
  type SocialNarrative,
  type SocialObservationFacts,
} from './socialObservationReport';
import type { BroadcastSnapshot } from './eventBroadcastView';

const now = Date.parse('2026-07-17T04:00:00Z');

const factsFixture: SocialObservationFacts = {
  dayKey: '2026-07-17',
  generatedAt: '2026-07-17T04:00:00.000Z',
  recordRange: '09:00:00–11:30:00',
  residentCount: 2,
  messageCount: 2,
  lifeEventCount: 2,
  observerInterventions: 1,
  conversations: [
    {
      conversationId: 'conversation:1',
      participants: ['林澜', '观察者'],
      messageCount: 2,
      messages: [
        { at: '10:00:00', author: '林澜', text: '我已经整理好记录。', observerIntervention: false },
        { at: '10:01:00', author: '观察者', text: '请继续记录。', observerIntervention: true },
      ],
    },
  ],
  residentFacts: [
    {
      residentId: 'lin-lan',
      name: '林澜',
      activities: ['工作：整理航标记录'],
      partners: ['观察者'],
      quotes: ['我已经整理好记录。'],
    },
    {
      residentId: 'su-ying',
      name: '苏萤',
      activities: [],
      partners: [],
      quotes: [],
    },
  ],
  institutionUses: [
    { institution: '灯塔书院', count: 2 },
    { institution: '无使用机构', count: 0 },
  ],
  activityFacts: [
    { at: '09:00:00', resident: '林澜', kind: '工作', text: '整理航标记录' },
    { at: '10:30:00', resident: '林澜', kind: '出行', text: '前往灯塔书院' },
  ],
  publicFacts: [
    { at: '11:30:00', kind: '公告', text: '灯塔书院今日开放' },
  ],
};

function reportSection(report: string, title: string) {
  const sectionStart = `## ${title}\n\n`;
  const startIndex = report.indexOf(sectionStart);
  if (startIndex < 0) throw new Error(`Missing report section: ${title}`);
  const contentStart = startIndex + sectionStart.length;
  const nextSection = report.indexOf('\n\n## ', contentStart);
  return report.slice(contentStart, nextSection < 0 ? undefined : nextSection);
}

function paddedDynamicText(prefix: string, graphemeLength: number) {
  return Array.from(`${prefix}${'&<>'.repeat(graphemeLength)}`)
    .slice(0, graphemeLength)
    .join('');
}

function expectAccurateOmission(report: string, title: string, total: number) {
  const section = reportSection(report, title);
  const displayed = section
    .split('\n')
    .filter((line) => line.startsWith('- ') && !line.startsWith('- 另有')).length;
  expect(section).toContain(`- 另有 ${total - displayed} 条记录未在本节展开`);
}

function hasLoneSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

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

  test('keeps distinct raw conversation ids from merging resident partners', () => {
    const facts = buildSocialObservationFacts(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [],
        dailyMessages: [
          {
            messageId: 'message:lin-lan',
            conversationId: 'a\nb',
            authorId: 'lin-lan',
            authorName: '林澜',
            text: '林澜的独立记录',
            createdAt: now - 1_000,
            observerIntervention: false,
          },
          {
            messageId: 'message:su-ying',
            conversationId: 'a / b',
            authorId: 'su-ying',
            authorName: '苏萤',
            text: '苏萤的独立记录',
            createdAt: now,
            observerIntervention: false,
          },
        ],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );

    expect(facts.conversations.map((conversation) => conversation.conversationId))
      .toEqual(['a\nb', 'a / b']);
    expect(facts.residentFacts.find((resident) => resident.name === '林澜')?.partners)
      .not.toContain('苏萤');
    expect(facts.residentFacts.find((resident) => resident.name === '苏萤')?.partners)
      .not.toContain('林澜');
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

  test('truncates fact quotes and digest fields without splitting surrogate pairs', () => {
    const unicodeText = `${'a'.repeat(99)}😀尾部`;
    const facts = buildSocialObservationFacts(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [],
        dailyMessages: [{
          messageId: 'unicode:message',
          conversationId: `${'c'.repeat(119)}😀尾部`,
          authorId: 'lin-lan',
          authorName: '林澜',
          text: unicodeText,
          createdAt: now,
          observerIntervention: false,
        }],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );

    const quote = facts.residentFacts.find((resident) => resident.name === '林澜')?.quotes[0];
    const digest = buildSocialObservationDigest(facts);
    expect(quote).toBe(`${'a'.repeat(99)}😀`);
    expect(hasLoneSurrogate(quote ?? '')).toBe(false);
    expect(hasLoneSurrogate(digest)).toBe(false);
    expect(digest).toContain('😀');
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
      publicFacts: [{
        at: '10:00:00',
        kind: structuralPayload,
        text: `${forgedObserverPayload} https://example.com/a-b?q=1.5`,
      }],
    };

    const digest = buildSocialObservationDigest(facts);

    expect(digest.split('\n')).toHaveLength(28);
    expect(digest.match(/｜参与者：/g)).toHaveLength(1);
    expect(digest).not.toContain('｜消息：999');
    expect(digest).not.toContain('**伪标题**');
    expect(digest).toContain('伪标题');
    expect(digest).not.toContain('｜观察者介入｜');
    expect(digest).toContain('观察者介入');
    expect(digest).not.toContain('_[]{}()#<>');
    expect(digest).toContain('2026-07-17T04:00:00.000Z');
    expect(digest).toContain('https://example.com/a-b?q=1.5');
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
    expect(digest.split('\n').filter((line) => /^【.+】$/.test(line))).toEqual([
      '【对话事实】',
      '【居民事实】',
      '【机构使用】',
      '【活动记录】',
      '【公共记录】',
    ]);
    expect(digest.split('\n').filter((line) => line.includes('｜参与者：'))).toHaveLength(1);
    expect(digest.split('\n').filter((line) => line.startsWith('  活动：'))).toHaveLength(1);
    expect(digest.split('\n').filter((line) => line.startsWith('  互动对象：'))).toHaveLength(1);
    expect(digest.split('\n').filter((line) => line.startsWith('  发言：'))).toHaveLength(1);
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
      residentFacts: [{
        residentId: 'lin-lan',
        name: '林澜',
        activities: ['居民代表活动'],
        partners: ['观察者'],
        quotes: ['居民代表发言'],
      }],
      institutionUses: [{ institution: '灯塔书院代表事实', count: 1 }],
      activityFacts: [{
        at: '11:00:00', resident: '林澜', kind: '工作', text: '活动代表事实',
      }],
      publicFacts: [{ at: '12:00:00', kind: '公告', text: '公共代表事实' }],
    };

    const digest = buildSocialObservationDigest(facts);

    expect(digest.length).toBeLessThanOrEqual(12_000);
    expect(digest).toMatch(/…（摘要已截断）$/);
    expect(digest).toMatch(/“[^”]*因此[^”]*证明[^”]*”/);
    expect(digest).not.toContain('｜消息：999');
    expect(digest).not.toMatch(/\\$/);
    for (const title of ['对话事实', '居民事实', '机构使用', '活动记录', '公共记录']) {
      expect(digest.match(new RegExp(`【${title}】`, 'g'))).toHaveLength(1);
    }
    expect(digest).toContain('居民代表活动');
    expect(digest).toContain('灯塔书院代表事实');
    expect(digest).toContain('活动代表事实');
    expect(digest).toContain('公共代表事实');
  });

  test('composes the ten factual report sections in a fixed order with fallback disclosure', () => {
    const fallbackResult: SocialNarrative = { source: 'fallback', narrative: '不应采用' };
    const report = buildSocialObservationReport(factsFixture, fallbackResult);
    const sectionTitles = [
      '观察范围与数据覆盖',
      '当日社会结构概览',
      '居民互动网络与关系动向',
      '友情、亲密关系与合作迹象',
      '商业生活、劳动与机构使用',
      '公共生活、规范、分歧与协调',
      '观察者介入及其可见影响',
      '本地模型辅助的谨慎观察',
      '后续值得持续记录的线索',
      '方法与边界说明',
    ];

    expect(report).toContain('# 灯塔镇社会观察日志');
    expect(report).toContain('日期：2026-07-17');
    expect(report.match(/^## .+$/gm)).toEqual(sectionTitles.map((title) => `## ${title}`));
    expect(report).toContain('记录范围：09:00:00–11:30:00');
    expect(report).toContain('居民：2；消息：2；生活事件：2');
    expect(report).toContain('林澜');
    expect(report).not.toContain('lin-lan');
    expect(report).toContain('活动：1 项');
    expect(report).toContain('当日可见伙伴：观察者');
    expect(report).toContain('conversation:1');
    expect(report).toContain('灯塔书院：2 次');
    expect(report).not.toContain('无使用机构');
    expect(report).toContain('灯塔书院今日开放');
    expect(report).toContain('观察者介入消息：1 条');
    expect(report).not.toContain('造成的变化');
    expect(report).toContain('本次未使用模型扩写；本节仅保留程序生成的事实统计。');
    expect(report).toMatch(/继续记录.+是否延续/);
    expect(report).toContain('人物设定不等于当日事实');
    expect(report).toContain('可能/值得记录不是因果结论，也不代表稳定人格');
    expect(report).not.toContain('已经证明');
  });

  test('contains model narrative as escaped single-line text without swallowing later sections', () => {
    const report = buildSocialObservationReport(factsFixture, {
      source: 'model',
      narrative: '<script>alert(1)</script>\n## 伪造章节',
    });

    expect(report).not.toContain('<script>');
    expect(report).not.toContain('\n## 伪造章节');
    expect(report).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(report).toContain('伪造章节');
    expect(reportSection(report, '本地模型辅助的谨慎观察').split('\n')).toHaveLength(1);
    expect(report.match(/^## 方法与边界说明$/gm)).toHaveLength(1);
    expect(report.match(/^## .+$/gm)).toHaveLength(10);
  });

  test('keeps medium model narratives complete and truncates oversized text on grapheme boundaries', () => {
    const narrative800 = '甲'.repeat(800);
    const narrative1400 = '乙'.repeat(1400);
    const report800 = buildSocialObservationReport(factsFixture, {
      source: 'model', narrative: narrative800,
    });
    const report1400 = buildSocialObservationReport(factsFixture, {
      source: 'model', narrative: narrative1400,
    });

    expect(reportSection(report800, '本地模型辅助的谨慎观察')).toContain(narrative800);
    expect(reportSection(report1400, '本地模型辅助的谨慎观察')).toContain(narrative1400);
    expect(report800).not.toContain('模型观察已截断');
    expect(report1400).not.toContain('模型观察已截断');

    const oversizedNarrative = '长'.repeat(6000);
    const oversizedReport = buildSocialObservationReport(factsFixture, {
      source: 'model', narrative: oversizedNarrative,
    });
    const modelSection = reportSection(oversizedReport, '本地模型辅助的谨慎观察');

    expect(modelSection).toContain('…（模型观察已截断）');
    expect(modelSection.match(/长/g)).toHaveLength(1600);
  });

  test('uses the uniform empty-record line for empty fact arrays', () => {
    const report = buildSocialObservationReport(
      {
        ...factsFixture,
        recordRange: '当日无记录',
        residentCount: 0,
        messageCount: 0,
        lifeEventCount: 0,
        observerInterventions: 0,
        conversations: [],
        residentFacts: [],
        institutionUses: [],
        activityFacts: [],
        publicFacts: [],
      },
      { source: 'model', narrative: '   ' },
    );

    expect(report.match(/^- 当日无记录$/gm)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(report).toContain('本次未使用模型扩写；本节仅保留程序生成的事实统计。');
  });

  test('does not list configured residents without any same-day facts', () => {
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
    const report = buildSocialObservationReport(facts, { source: 'fallback', narrative: '' });

    expect(facts.residentFacts.length).toBeGreaterThan(0);
    expect(reportSection(report, '当日社会结构概览')).toBe('- 当日无记录');
    for (const title of [
      '居民互动网络与关系动向',
      '友情、亲密关系与合作迹象',
      '商业生活、劳动与机构使用',
      '公共生活、规范、分歧与协调',
      '后续值得持续记录的线索',
    ]) {
      expect(reportSection(report, title)).toBe('- 当日无记录');
    }
  });

  test('encodes resident and institution text without allowing forged report headings', () => {
    const structuralPayload = '中文、；（）“” https://x.co/a-b?q=1.5\n## 伪造标题\n- 伪造列表\n|伪造|表格|<script>x</script>';
    const report = buildSocialObservationReport(
      {
        ...factsFixture,
        residentFacts: [{
          residentId: structuralPayload,
          name: structuralPayload,
          activities: [structuralPayload],
          partners: [structuralPayload],
          quotes: [],
        }],
        institutionUses: [{ institution: structuralPayload, count: 1 }],
      },
      { source: 'fallback', narrative: '' },
    );

    expect(report).not.toContain('\n## 伪造标题');
    expect(report).not.toContain('\n- 伪造列表');
    expect(report).not.toContain('|伪造|表格|');
    expect(report).not.toContain('<script>');
    expect(report).toContain('中文、；（）“” https://x.co/a-b?q=1.5');
    expect(report).toContain('\\|伪造\\|表格\\|');
    expect(report).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(report).toContain('伪造标题');
    expect(report.match(/^## .+$/gm)).toHaveLength(10);
  });

  test('bounds and deduplicates every high-volume report section without losing later headings', () => {
    const conversations = Array.from({ length: 500 }, (_, index) => {
      const recordIndex = index % 250;
      return {
        conversationId: `conversation:${recordIndex}`,
        participants: Array.from({ length: 10 }, (__, participant) =>
          `居民${recordIndex}-${participant}`),
        messageCount: 1,
        messages: [],
      };
    });
    const residents = Array.from({ length: 20 }, (_, index) => ({
      residentId: `resident:${index}`,
      name: `居民${index}`,
      activities: [`活动${index}`],
      partners: [`伙伴${index}`],
      quotes: [],
    }));
    const activityFacts = Array.from({ length: 500 }, (_, index) => {
      const recordIndex = index % 250;
      return {
        at: '10:00:00', resident: `居民${recordIndex}`, kind: '工作',
        text: `活动记录${recordIndex}`,
      };
    });
    const publicFacts = Array.from({ length: 500 }, (_, index) => {
      const recordIndex = index % 250;
      return { at: '11:00:00', kind: `公告${recordIndex}`, text: `公共记录${recordIndex}` };
    });
    const report = buildSocialObservationReport(
      {
        ...factsFixture,
        residentCount: residents.length,
        messageCount: conversations.length,
        lifeEventCount: activityFacts.length,
        conversations,
        residentFacts: residents,
        institutionUses: Array.from({ length: 20 }, (_, index) => ({
          institution: `机构${index}`, count: 1,
        })),
        activityFacts,
        publicFacts,
      },
      { source: 'fallback', narrative: '' },
    );

    expect(report.length).toBeLessThanOrEqual(12_000);
    expect(report.match(/^## .+$/gm)).toHaveLength(10);
    for (const title of [
      '当日社会结构概览',
      '居民互动网络与关系动向',
      '友情、亲密关系与合作迹象',
      '商业生活、劳动与机构使用',
      '公共生活、规范、分歧与协调',
      '后续值得持续记录的线索',
    ]) {
      expect(reportSection(report, title)).toMatch(/另有 \d+ 条记录未在本节展开/);
    }
    expect(reportSection(report, '居民互动网络与关系动向'))
      .toContain('另有 4 位参与者未展开');
    expect(report.match(/会话 conversation:0：/g)).toHaveLength(1);
    expect(report.match(/^## 方法与边界说明$/gm)).toHaveLength(1);
  });

  test('closes the total report budget after worst-case HTML entity expansion', () => {
    const conversations = Array.from({ length: 500 }, (_, index) => {
      const recordIndex = index % 250;
      return {
        conversationId: paddedDynamicText(`conversation-${recordIndex}-`, 80),
        participants: Array.from({ length: 10 }, (__, participant) =>
          paddedDynamicText(`居民-${recordIndex}-${participant}-`, 60)),
        messageCount: 1,
        messages: [],
      };
    });
    const residents = Array.from({ length: 20 }, (_, index) => ({
      residentId: `resident:${index}`,
      name: paddedDynamicText(`居民-${index}-`, 60),
      activities: [paddedDynamicText(`活动-${index}-`, 120)],
      partners: [paddedDynamicText(`伙伴-${index}-`, 60)],
      quotes: [],
    }));
    const activityFacts = Array.from({ length: 500 }, (_, index) => {
      const recordIndex = index % 250;
      return {
        at: paddedDynamicText('时间-', 20),
        resident: paddedDynamicText(`居民-${recordIndex}-`, 60),
        kind: paddedDynamicText('工作-', 40),
        text: paddedDynamicText(`活动-${recordIndex}-`, 120),
      };
    });
    const publicFacts = Array.from({ length: 500 }, (_, index) => {
      const recordIndex = index % 250;
      return {
        at: paddedDynamicText('时间-', 20),
        kind: paddedDynamicText(`公告-${recordIndex}-`, 40),
        text: paddedDynamicText(`公共-${recordIndex}-`, 120),
      };
    });
    const worstFacts: SocialObservationFacts = {
      ...factsFixture,
      dayKey: paddedDynamicText('2026-07-17-', 40),
      recordRange: paddedDynamicText('09:00-11:30-', 80),
      residentCount: residents.length,
      messageCount: conversations.length,
      lifeEventCount: activityFacts.length,
      conversations,
      residentFacts: residents,
      institutionUses: Array.from({ length: 20 }, (_, index) => ({
        institution: paddedDynamicText(`机构-${index}-`, 80), count: 1,
      })),
      activityFacts,
      publicFacts,
    };
    const reports = [
      buildSocialObservationReport(worstFacts, { source: 'fallback', narrative: '' }),
      buildSocialObservationReport(worstFacts, {
        source: 'model', narrative: '模型观察'.repeat(350),
      }),
    ];

    for (const report of reports) {
      expect(report.length).toBeLessThanOrEqual(12_000);
      expect(report.match(/^## .+$/gm)).toHaveLength(10);
      expect(report.match(/^## 方法与边界说明$/gm)).toHaveLength(1);
      expectAccurateOmission(report, '当日社会结构概览', 20);
      expectAccurateOmission(report, '居民互动网络与关系动向', 250);
      expectAccurateOmission(report, '友情、亲密关系与合作迹象', 20);
      expectAccurateOmission(report, '商业生活、劳动与机构使用', 270);
      expectAccurateOmission(report, '公共生活、规范、分歧与协调', 250);
      expectAccurateOmission(report, '后续值得持续记录的线索', 540);
    }
    expect(reportSection(reports[1], '本地模型辅助的谨慎观察'))
      .toContain('模型观察'.repeat(350));
  });

  test('escapes list markers only when dynamic text starts a report list item', () => {
    const report = buildSocialObservationReport(
      {
        ...factsFixture,
        residentFacts: [{
          residentId: 'resident:list',
          name: '- 居民列表',
          activities: ['记录'],
          partners: [],
          quotes: [],
        }],
        institutionUses: [{ institution: '+ 机构列表', count: 1 }],
        publicFacts: [{
          at: '11:00:00', kind: '公告',
          text: '1. 公共列表 https://example.com/a-b?q=1.5',
        }],
      },
      { source: 'model', narrative: '- 模型列表' },
    );

    expect(report).not.toMatch(/^- (?:-|\+|\d+\.) /gm);
    expect(report).toContain('\\- 居民列表');
    expect(report).toContain('\\+ 机构列表');
    expect(report).toContain('1\\. 公共列表');
    expect(reportSection(report, '本地模型辅助的谨慎观察')).toContain('- \\- 模型列表');
    expect(report).toContain('https://example.com/a-b?q=1.5');
  });

  test('keeps fallback grapheme clusters intact without Intl.Segmenter', () => {
    const family = '👨‍👩‍👧‍👦';
    const combining = 'e\u0301';
    const escaped = escapeReportMarkdown(
      `${family}${combining}${family}`,
      2,
      '…',
      200,
      null,
    );
    const beforeMarker = escaped.replace(/…$/, '');
    const variationEscaped = escapeReportMarkdown(
      `A✈️${combining}x`,
      3,
      '…',
      200,
      null,
    );

    expect(escaped).toBe(`${family}…`);
    expect(beforeMarker).not.toMatch(/[\u200d\ufe0e\ufe0f\p{M}]$/u);
    expect(variationEscaped).toBe('A…');
  });
});
