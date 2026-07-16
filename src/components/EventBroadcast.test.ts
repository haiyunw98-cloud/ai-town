import { readFileSync } from 'node:fs';
import {
  buildDailyReport,
  buildBroadcastView,
  buildTownStory,
  type BroadcastSnapshot,
} from './eventBroadcastView';

const running: BroadcastSnapshot = {
  event: {
    id: 'event-1',
    name: '灯塔镇百万金贝寻宝赛',
    status: 'running',
    phase: 'treasureHunt',
    phaseEndsAt: 70_000,
    prize: '一百万金贝',
  },
  participants: [
    {
      residentId: 'p:1',
      displayName: '顾潮',
      score: 88,
      shells: 3,
      active: true,
      role: 'competitor',
      rank: 1,
      quote: '灯火照路，我先走一步！',
    },
  ],
  logs: [],
  conversations: [],
  residentActivity: [],
  dailyMessages: [{
    messageId: 'm:1',
    conversationId: 'c:1',
    authorId: 'p:1',
    authorName: '顾潮',
    text: '今晚去机关坊试灯。',
    createdAt: 21_000,
    observerIntervention: false,
  }],
};

describe('event broadcast view model', () => {
  test('attributes observer intervention only to actual human player ids', async () => {
    const eventsModule = await import('../../convex/events') as Record<string, unknown>;

    expect(eventsModule).toHaveProperty('isObserverIntervention');
    const isObserverIntervention = eventsModule.isObserverIntervention as (
      humanPlayerIds: ReadonlySet<string>,
      authorId: string,
    ) => boolean;
    const humanPlayerIds = new Set(['p:human']);

    expect(isObserverIntervention(humanPlayerIds, 'p:human')).toBe(true);
    expect(isObserverIntervention(humanPlayerIds, 'p:named-ai')).toBe(false);
    expect(isObserverIntervention(humanPlayerIds, 'p:missing-description-ai')).toBe(false);
  });

  test('uses town chronicle mode before an event exists', () => {
    const view = buildBroadcastView(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [],
        dailyMessages: [],
      },
      'zh-CN',
      10_000,
    );
    expect(view.mode).toBe('chronicle');
    expect(view.title).toBe('灯塔镇镇志');
  });

  test('turns grouped resident dialogue into an observer-friendly town story', () => {
    const story = buildTownStory([
      {
        conversationId: 'c:1',
        participantNames: ['白露', '墨七'],
        summary: '白露与墨七正在追查河道异常，并担心野花枯萎。',
        updatedAt: 12_000,
        messages: [
          { authorName: '墨七', text: '这些野花恐怕撑不了几个昼夜。', createdAt: 11_000 },
        ],
      },
      {
        conversationId: 'c:2',
        participantNames: ['唐果', '顾潮'],
        summary: '唐果提醒顾潮小心灯塔下方的机关。',
        updatedAt: 10_000,
        messages: [],
      },
    ]);

    expect(story.headline).toContain('小镇异变');
    expect(story.bullets).toHaveLength(2);
    expect(story.bullets[0]).toContain('白露');
  });

  test('formats a running phase and countdown for observers', () => {
    const view = buildBroadcastView(running, 'zh-CN', 10_000);
    expect(view.mode).toBe('event');
    expect(view.phaseLabel).toBe('八人寻宝冲刺');
    expect(view.countdown).toBe('01:00');
    expect(view.activeCount).toBe(1);
  });

  test('shows the winner after awards', () => {
    const completed: BroadcastSnapshot = {
      ...running,
      event: { ...running.event!, status: 'completed', phase: 'awards', winnerId: 'p:1' },
    };
    const view = buildBroadcastView(completed, 'zh-CN', 80_000);
    expect(view.phaseLabel).toBe('百万金贝颁奖礼');
    expect(view.winnerName).toBe('顾潮');
  });

  test('exports the complete factual report in the required section order', () => {
    const now = new Date(1970, 0, 2, 12).getTime();
    const at = (hour: number) => new Date(1970, 0, 2, hour).getTime();
    const report = buildDailyReport(
      {
        event: {
          id: 'event-completed',
          name: '灯塔镇百万金贝寻宝赛',
          status: 'completed',
          phase: 'awards',
          phaseEndsAt: at(11),
          winnerId: 'gu-chao',
          prize: '一百万金贝',
        },
        participants: [
          {
            residentId: 'gu-chao',
            displayName: '顾潮',
            score: 88,
            shells: 3,
            active: false,
            role: 'competitor',
            rank: 1,
          },
        ],
        logs: [
          {
            eventKey: 'event-completed',
            sequence: 1,
            kind: 'award',
            text: '颁奖记录：顾潮领取一百万金贝。',
            createdAt: at(11),
          },
        ],
        residentActivity: [
          { residentId: 'gu-chao', displayName: '顾潮', status: '生活中', detail: '制作船灯' },
          { residentId: 'su-ying', displayName: '苏萤', status: '休息中', detail: '整理工具' },
        ],
        dailyLifeEvents: [
          { residentId: 'gu-chao', displayName: '顾潮', kind: 'work', text: '顾潮在苏氏机关坊完成抗风船灯', createdAt: at(8) },
          { residentId: 'su-ying', displayName: '苏萤', kind: 'social', text: '苏萤与顾潮核对船灯清单', createdAt: at(9) },
        ],
        conversations: [
          {
            conversationId: 'c:1',
            participantNames: ['顾潮', '苏萤'],
            summary: '顾潮与苏萤商量了船灯订单。',
            updatedAt: at(10),
            messages: [{ authorName: '顾潮', text: '今晚试灯。', createdAt: at(10) }],
          },
        ],
        dailyMessages: [
          {
            messageId: 'm:1',
            conversationId: 'c:1',
            authorId: 'gu-chao',
            authorName: '顾潮',
            text: '今晚试灯。',
            createdAt: at(10),
            observerIntervention: false,
          },
          {
            messageId: 'm:2',
            conversationId: 'c:1',
            authorId: 'observer',
            authorName: '观察者',
            text: '请记录当前进度。',
            createdAt: at(10) + 1,
            observerIntervention: true,
          },
        ],
      },
      'zh-CN',
      now,
    );

    expect(report).toContain('# 灯塔镇完整观察日报');
    expect(report.match(/^## .+$/gm)).toEqual([
      '## 日报元数据',
      '## 全镇事实概览',
      '## 居民逐人记录',
      '## 关系记录',
      '## 机构与地点',
      '## 活动分类',
      '## 当日对话',
      '## 赛事与公共事件',
      '## 生活记录附录',
      '## 原始对话附录',
      '## 数据说明',
    ]);
    expect(report).toContain('人物设定关系');
    expect(report).toContain('当日实际互动');
    expect(report).toContain('观察者介入');
    expect(report).toContain('当日无记录');
    expect(report).toContain('顾潮在苏氏机关坊完成抗风船灯');
    expect(report).toContain('冠军：顾潮');
    expect(report).toContain('奖励：一百万金贝');
    expect(report).toContain('林澜');
    expect(report).toContain('玄微先生');
  });

  test('keeps the daily report factual and identifies every configured institution', () => {
    const now = new Date(1970, 0, 2, 12).getTime();
    const report = buildDailyReport(
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

    for (const landmark of [
      '灯塔书院', '白露药庐', '旧水码头', '听潮卦馆', '听雨茶庄',
      '晨雾集市', '镇公所', '苏氏机关坊', '望潮食肆',
    ]) {
      expect(report).toContain(landmark);
    }
    expect(report).toContain('设定内容不属于当日事实');
    expect(report).toContain('不补全缺失事实');
    expect(report).toContain('不推断原因或动机');
    expect(report).not.toMatch(/因此导致|内心认为|形成派系|社会中心|证明了/);
  });

  test('maps runtime resident ids from localized activity names before attributing records', () => {
    const now = new Date(1970, 0, 2, 12).getTime();
    const at = (hour: number) => new Date(1970, 0, 2, hour).getTime();
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [{
          conversationId: 'c:runtime',
          participantNames: ['Lin Lan', 'Su Ying'],
          summary: 'Runtime identity conversation.',
          updatedAt: at(10),
          messages: [],
        }],
        residentActivity: [
          { residentId: 'p:0', displayName: 'Lin Lan', status: 'On duty', detail: 'Checking the light' },
        ],
        dailyLifeEvents: [
          { residentId: 'p:0', displayName: 'Resident', kind: 'work', text: 'Runtime ID life record', createdAt: at(8) },
        ],
        dailyMessages: [
          {
            messageId: 'm:runtime',
            conversationId: 'c:runtime',
            authorId: 'p:0',
            authorName: 'Resident',
            text: 'Runtime ID dialogue',
            createdAt: at(9),
            observerIntervention: false,
          },
        ],
      },
      'zh-CN',
      now,
    );
    const residentSection = report.slice(
      report.indexOf('## 居民逐人记录'),
      report.indexOf('## 关系记录'),
    );
    const linLan = residentSection.slice(
      residentSection.indexOf('### 林澜'),
      residentSection.indexOf('### 沈砚'),
    );
    const suYing = residentSection.slice(
      residentSection.indexOf('### 苏萤'),
      residentSection.indexOf('### 白露'),
    );

    expect(linLan).toContain('On duty');
    expect(linLan).toContain('Runtime ID life record');
    expect(suYing).not.toContain('Runtime ID life record');
    expect(report).toContain('[p:0] 林澜：“Runtime ID dialogue”');
    expect(report).toContain('[p:0] 林澜｜Runtime ID dialogue');
  });

  test('escapes hostile dynamic text without corrupting later Markdown sections', () => {
    const now = new Date(1970, 0, 2, 12).getTime();
    const hostile = '<!-- A&B # heading `code` | *bold* [link](url) {x} + - . ! \\ -->\nnext';
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [{
          eventKey: hostile,
          sequence: 1,
          kind: 'hostile',
          text: hostile,
          createdAt: now,
        }],
        conversations: [{
          conversationId: 'c:hostile',
          participantNames: [hostile, '苏萤'],
          summary: hostile,
          updatedAt: now,
          messages: [{ authorName: hostile, text: hostile, createdAt: now }],
        }],
        residentActivity: [{ residentId: 'p:hostile', displayName: 'Lin Lan', status: hostile, detail: hostile }],
        dailyLifeEvents: [{ residentId: 'p:hostile', displayName: hostile, kind: 'work', text: hostile, createdAt: now }],
        dailyMessages: [],
      },
      'zh-CN',
      now,
    );

    expect(report).not.toContain('<!--');
    expect(report).toContain('&lt;\\!\\-\\- A&amp;B \\# heading');
    expect(report).toContain('\\`code\\`');
    expect(report).toContain('\\| \\*bold\\* \\[link\\]\\(url\\) \\{x\\} \\+ \\- \\. \\!');
    expect(report).toContain(' / next');
    expect(report.match(/^## .+$/gm)?.at(-1)).toBe('## 数据说明');
  });

  test('prefers known resident ids and falls back to names only for unrecognized ids', () => {
    const now = new Date(1970, 0, 2, 12).getTime();
    const at = (hour: number) => new Date(1970, 0, 2, hour).getTime();
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [
          {
            conversationId: 'c:1',
            participantNames: ['林澜', '苏萤'],
            summary: '矛盾身份记录测试。',
            updatedAt: at(11),
            messages: [],
          },
        ],
        residentActivity: [
          { residentId: 'lin-lan', displayName: '苏萤', status: 'ID 优先状态', detail: '来自矛盾记录' },
          { residentId: 'p:unknown', displayName: '苏萤', status: '姓名回退状态', detail: '来自未识别 ID' },
        ],
        dailyLifeEvents: [
          { residentId: 'lin-lan', displayName: '苏萤', kind: 'work', text: 'ID 优先生活记录', createdAt: at(8) },
          { residentId: 'p:unknown', displayName: '苏萤', kind: 'work', text: '姓名回退生活记录', createdAt: at(9) },
        ],
        dailyMessages: [
          {
            messageId: 'm:id-first',
            conversationId: 'c:1',
            authorId: 'lin-lan',
            authorName: '苏萤',
            text: 'ID 优先原始消息',
            createdAt: at(10),
            observerIntervention: false,
          },
          {
            messageId: 'm:name-fallback',
            conversationId: 'c:1',
            authorId: 'p:unknown',
            authorName: '苏萤',
            text: '姓名回退原始消息',
            createdAt: at(11),
            observerIntervention: false,
          },
        ],
      },
      'zh-CN',
      now,
    );
    const residentSection = report.slice(
      report.indexOf('## 居民逐人记录'),
      report.indexOf('## 关系记录'),
    );
    const linLan = residentSection.slice(
      residentSection.indexOf('### 林澜'),
      residentSection.indexOf('### 沈砚'),
    );
    const suYing = residentSection.slice(
      residentSection.indexOf('### 苏萤'),
      residentSection.indexOf('### 白露'),
    );
    const rawMessages = report.slice(
      report.indexOf('## 原始对话附录'),
      report.indexOf('## 数据说明'),
    );
    const conversations = report.slice(
      report.indexOf('## 当日对话'),
      report.indexOf('## 赛事与公共事件'),
    );

    expect(linLan).toContain('ID 优先状态');
    expect(linLan).toContain('ID 优先生活记录');
    expect(suYing).not.toContain('ID 优先状态');
    expect(suYing).not.toContain('ID 优先生活记录');
    expect(suYing).toContain('姓名回退状态');
    expect(suYing).toContain('姓名回退生活记录');
    expect(rawMessages).toContain('[lin\\-lan] 林澜｜ID 优先原始消息');
    expect(rawMessages).toContain('[p:unknown] 苏萤｜姓名回退原始消息');
    expect(conversations).toContain('[lin\\-lan] 林澜：“ID 优先原始消息”');
    expect(conversations).not.toContain('苏萤：“ID 优先原始消息”');
  });

  test('uses the latest four same-day raw messages in chronological order', () => {
    const now = new Date(1970, 0, 2, 12).getTime();
    const at = (hour: number) => new Date(1970, 0, 2, hour).getTime();
    const message = (messageId: string, text: string, createdAt: number) => ({
      messageId,
      conversationId: 'c:1',
      authorId: 'p:1',
      authorName: '顾潮',
      text,
      createdAt,
      observerIntervention: false,
    });
    const report = buildDailyReport(
      {
        ...running,
        conversations: [{
          conversationId: 'c:1',
          participantNames: ['顾潮', '苏萤'],
          summary: '顾潮与苏萤依次完成试灯。',
          updatedAt: at(11),
          messages: [],
        }],
        dailyMessages: [
          message('m:5', '第五条。', at(11)),
          message('m:2', '第二条。', at(8)),
          message('m:off-day', '昨日消息。', new Date(1970, 0, 1, 23).getTime()),
          message('m:4', '第四条。', at(10)),
          message('m:1', '第一条。', at(7)),
          message('m:3', '第三条。', at(9)),
        ],
      },
      'zh-CN',
      now,
    );

    const conversationSection = report.slice(
      report.indexOf('## 当日对话'),
      report.indexOf('## 赛事与公共事件'),
    );
    expect(conversationSection).not.toContain('第一条。');
    expect(report).not.toContain('昨日消息。');
    expect(conversationSection).toContain('[p:1] 顾潮：“第二条。”；[p:1] 顾潮：“第三条。”；[p:1] 顾潮：“第四条。”；[p:1] 顾潮：“第五条。”');
    expect(report).toContain('第一条。');
  });

  test('builds complete report conversations from all same-day raw messages', () => {
    const dayStart = Date.parse('2026-07-15T16:00:00Z');
    const now = dayStart + 12 * 60 * 60 * 1000;
    const dailyMessages = Array.from({ length: 90 }, (_, index) => {
      const conversationId = index < 20
        ? 'c:early'
        : `c:${1 + Math.floor((index - 20) / 10)}`;
      const isLinLan = index % 2 === 0;
      return {
        messageId: `m:${index}`,
        conversationId,
        authorId: isLinLan ? 'lin-lan' : 'su-ying',
        authorName: isLinLan ? '林澜' : '苏萤',
        text: `完整消息 ${index}`,
        createdAt: dayStart + index * 60_000,
        observerIntervention: false,
      };
    });
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: Array.from({ length: 6 }, (_, index) => ({
          conversationId: `c:${index + 2}`,
          participantNames: ['林澜', '苏萤'],
          summary: `旧卡片摘要 ${index + 2}`,
          updatedAt: dayStart + (index + 1) * 60_000,
          messages: [],
        })),
        residentActivity: [],
        dailyMessages,
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );
    const interactionSection = report.slice(
      report.indexOf('### 当日实际互动'),
      report.indexOf('## 机构与地点'),
    );
    const conversationSection = report.slice(
      report.indexOf('## 当日对话'),
      report.indexOf('## 赛事与公共事件'),
    );

    expect(report).toContain('当日对话：8 组');
    expect(interactionSection).toContain('林澜 × 苏萤｜消息 20 条');
    expect(conversationSection).toContain('参与者共交换 20 条消息');
    expect(conversationSection).toContain('完整消息 19');
  });

  test('does not create report conversations from legacy-only cards', () => {
    const now = Date.parse('2026-07-16T04:00:00Z');
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [{
          conversationId: 'c:phantom',
          participantNames: ['幽灵甲', '幽灵乙'],
          summary: '不应进入日报的旧卡片摘要',
          updatedAt: now,
          messages: [{ authorName: '幽灵甲', text: '旧卡片消息', createdAt: now }],
        }],
        residentActivity: [],
        dailyMessages: [],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );
    const interactionSection = report.slice(
      report.indexOf('### 当日实际互动'),
      report.indexOf('## 机构与地点'),
    );
    const conversationSection = report.slice(
      report.indexOf('## 当日对话'),
      report.indexOf('## 赛事与公共事件'),
    );

    expect(report).toContain('当日对话：0 组');
    expect(interactionSection).toContain('- 当日无记录');
    expect(conversationSection).toContain('- 当日无记录');
    expect(report).not.toContain('幽灵甲');
    expect(report).not.toContain('不应进入日报的旧卡片摘要');
  });

  test('marks resident settings separately and records daily partners and representative quotes', () => {
    const now = Date.parse('2026-07-16T04:00:00Z');
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [
          { residentId: 'p:0', displayName: 'Lin Lan', status: '值守中', detail: '检查灯光' },
          { residentId: 'p:1', displayName: 'Su Ying', status: '工作中', detail: '整理工具' },
        ],
        dailyMessages: [
          {
            messageId: 'm:lin', conversationId: 'c:partners', authorId: 'p:0', authorName: 'Lin Lan',
            text: '我记录了今晚的灯光。', createdAt: now - 2_000, observerIntervention: false,
          },
          {
            messageId: 'm:su', conversationId: 'c:partners', authorId: 'p:1', authorName: 'Su Ying',
            text: '我来检查装置。', createdAt: now - 1_000, observerIntervention: false,
          },
        ],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );
    const residentSection = report.slice(
      report.indexOf('### 林澜'),
      report.indexOf('### 沈砚'),
    );

    expect(residentSection).toContain('[人物设定] 住所：灯塔东侧守望人小屋');
    expect(residentSection).toContain('[人物设定] 性格：温和、谨慎、责任感强、慢热');
    expect(residentSection).toContain('[人物设定] 穿着：');
    expect(residentSection).toContain('[人物设定] 饮食：');
    expect(residentSection).toContain('[人物设定] 生计：');
    expect(residentSection).toContain('[人物设定] 当前目标：');
    expect(residentSection).toContain('[当日事实] 对话伙伴：苏萤');
    expect(residentSection).toContain('[当日事实] 代表发言：[p:0] 林澜：“我记录了今晚的灯光。”');
  });

  test('uses Shanghai day boundaries for report filtering and exported day keys', async () => {
    const reportModule = await import('./eventBroadcastView') as Record<string, unknown>;

    expect(reportModule).toHaveProperty('shanghaiDayKey');
    const shanghaiDayKey = reportModule.shanghaiDayKey as (timestamp: number) => string;
    const now = Date.parse('2026-07-15T16:30:00Z');
    expect(shanghaiDayKey(now)).toBe('2026-07-16');
    expect(shanghaiDayKey(Date.parse('2026-07-15T15:59:00Z'))).toBe('2026-07-15');

    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [],
        dailyMessages: [
          {
            messageId: 'm:before', conversationId: 'c:before', authorId: 'lin-lan', authorName: '林澜',
            text: '上海前一日消息', createdAt: Date.parse('2026-07-15T15:59:00Z'), observerIntervention: false,
          },
          {
            messageId: 'm:current', conversationId: 'c:current', authorId: 'lin-lan', authorName: '林澜',
            text: '上海当日消息', createdAt: Date.parse('2026-07-15T16:00:00Z'), observerIntervention: false,
          },
        ],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );

    expect(report).toContain('日期：2026年07月16日');
    expect(report).toContain('上海当日消息');
    expect(report).not.toContain('上海前一日消息');
  });

  test('excludes ordinary conversation logs from public events', () => {
    const now = Date.parse('2026-07-16T04:00:00Z');
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [{
          eventKey: 'message:1', sequence: 1, kind: 'conversation',
          text: '普通消息日志', createdAt: now,
        }],
        conversations: [],
        residentActivity: [],
        dailyMessages: [],
        dailyLifeEvents: [],
      },
      'zh-CN',
      now,
    );
    const publicSection = report.slice(
      report.indexOf('## 赛事与公共事件'),
      report.indexOf('## 生活记录附录'),
    );

    expect(report).toContain('当日公共事件日志：0 条');
    expect(publicSection).toContain('- 当日无记录');
    expect(publicSection).not.toContain('普通消息日志');
    expect(report).toContain('记录范围：当日无记录');
  });

  test('renders the complete same-day record range in Shanghai time', () => {
    const now = Date.parse('2026-07-16T04:00:00Z');
    const report = buildDailyReport(
      {
        event: null,
        participants: [],
        logs: [
          { eventKey: 'public:1', sequence: 1, kind: 'announcement', text: '公共日志', createdAt: Date.parse('2026-07-16T02:00:00Z') },
          { eventKey: 'message:later', sequence: 2, kind: 'conversation', text: '不计入范围', createdAt: Date.parse('2026-07-16T03:00:00Z') },
        ],
        conversations: [],
        residentActivity: [],
        dailyMessages: [{
          messageId: 'm:range', conversationId: 'c:range', authorId: 'lin-lan', authorName: '林澜',
          text: '范围消息', createdAt: Date.parse('2026-07-16T01:00:00Z'), observerIntervention: false,
        }],
        dailyLifeEvents: [{
          residentId: 'lin-lan', displayName: '林澜', kind: 'work', text: '范围生活记录',
          createdAt: Date.parse('2026-07-16T00:00:00Z'),
        }],
      },
      'zh-CN',
      now,
    );

    expect(report).toContain('记录范围：08:00:00–10:00:00');
    expect(report).not.toContain('不计入范围');
  });

  test('keeps complete raw message capture separate from 80-message legacy views', () => {
    const source = readFileSync(new URL('../../convex/events.ts', import.meta.url), 'utf8');

    expect(source).toContain('.take(500)');
    expect(source).toContain('const legacyMessages = messages.slice(0, 80);');
    expect(source).toContain('groupConversationMessages(legacyMessages, names');
    expect(source).toContain('logs: legacyMessages.map((message, index) => ({');
    expect(source).toContain('const dailyMessages = messages.map((message) => ({');
  });

  test('labels the one-click export as a complete observation report', () => {
    const source = readFileSync(new URL('./EventBroadcast.tsx', import.meta.url), 'utf8');

    expect(source).toContain('导出完整日报');
    expect(source).toContain('人物、关系、地点、活动与原始对话');
    expect(source).toContain('aria-label="导出完整观察日报"');
    expect(source).toContain('灯塔镇完整观察日报-');
    expect(source).toContain('const exportNow = Date.now();');
    expect(source).toContain('buildDailyReport(snapshot, locale, exportNow)');
    expect(source).toContain('shanghaiDayKey(exportNow)');
  });
});
