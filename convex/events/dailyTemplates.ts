import type { DailyTemplateId } from './dailySchedule';

export type VenueMode = 'main-town' | 'trial-island';

export type DailyStageId =
  | 'assembly'
  | 'round-one'
  | 'round-two'
  | 'break'
  | 'semifinal'
  | 'final'
  | 'awards';

export type DailyEventChoice = Readonly<{
  id: string;
  label: string;
}>;

export type DailyEventStage = {
  id: DailyStageId;
  label: string;
  endsAtMinute: number;
  targetActive: number;
  checkpoints: string[];
  props: string[];
  choices: readonly DailyEventChoice[];
};

export type DailyEventTemplate = {
  id: DailyTemplateId;
  name: string;
  venue: VenueMode;
  participantCount: 9;
  teamCount: 2;
  eliminationResult: 'spectator';
  stages: DailyEventStage[];
};

const STAGE_IDS: DailyStageId[] = [
  'assembly',
  'round-one',
  'round-two',
  'break',
  'semifinal',
  'final',
  'awards',
];
const STAGE_END_MINUTES = [10, 35, 60, 70, 90, 110, 120];
const STAGE_ACTIVE_COUNTS = [9, 8, 6, 6, 4, 1, 1];
const STAGE_CHOICES: DailyEventChoice[][] = [
  [
    { id: 'encourage', label: '鼓励同伴' },
    { id: 'observe', label: '先看规则' },
  ],
  [
    { id: 'steady', label: '稳步完成' },
    { id: 'sprint', label: '加快节奏' },
  ],
  [
    { id: 'lead', label: '主动带队' },
    { id: 'follow', label: '配合同伴' },
  ],
  [
    { id: 'share', label: '分享信息' },
    { id: 'rest', label: '安静休息' },
  ],
  [
    { id: 'coordinate', label: '协调分工' },
    { id: 'focus', label: '专注任务' },
  ],
  [
    { id: 'steady-final', label: '稳健完成' },
    { id: 'push-final', label: '争取领先' },
  ],
  [
    { id: 'thank', label: '感谢同伴' },
    { id: 'reflect', label: '回顾过程' },
  ],
];

type TemplateConfiguration = {
  id: DailyTemplateId;
  name: string;
  venue: VenueMode;
  labels: string[];
  checkpoints: string[];
  props: string[];
};

const configurations: TemplateConfiguration[] = [
  {
    id: 'safe-survival',
    name: '试炼岛安全协作赛',
    venue: 'trial-island',
    labels: ['码头集合登船', '按令前进赛道', '彩色踏板过桥', '庭院茶歇', '团队拔河', '终点接力', '颁奖返程'],
    checkpoints: ['old-dock', 'island-track', 'island-bridge', 'island-courtyard', 'island-team-field', 'island-final', 'island-awards'],
    props: ['ferry', 'signal-flags', 'color-tiles', 'tea-table', 'rope', 'finish-line', 'podium'],
  },
  {
    id: 'town-relay',
    name: '全镇任务接力',
    venue: 'main-town',
    labels: ['广场集合', '书院整理', '集市配送', '茶庄茶歇', '工坊组装', '街巷服务', '广场颁奖'],
    checkpoints: ['plaza', 'academy', 'morning-market', 'tea-house', 'workshop', 'town-office', 'plaza'],
    props: ['notice-board', 'books', 'delivery-crates', 'tea-table', 'parts', 'service-stall', 'podium'],
  },
  {
    id: 'island-resources',
    name: '试炼岛物资协作赛',
    venue: 'trial-island',
    labels: ['码头集合登船', '工具搜集', '迷宫物资搜集', '庭院茶歇', '团队搭建', '物资护送', '颁奖返程'],
    checkpoints: ['old-dock', 'island-resource-zone', 'island-maze', 'island-courtyard', 'island-team-field', 'island-final', 'island-awards'],
    props: ['ferry', 'toolboxes', 'food-crates', 'tea-table', 'building-parts', 'supply-cart', 'podium'],
  },
  {
    id: 'market-business',
    name: '小镇经营赛',
    venue: 'main-town',
    labels: ['镇公所登记', '集市采购', '工坊生产', '茶庄茶歇', '食肆服务', '集市结算', '广场颁奖'],
    checkpoints: ['town-office', 'morning-market', 'workshop', 'tea-house', 'restaurant', 'morning-market', 'plaza'],
    props: ['contracts', 'market-stalls', 'materials', 'tea-table', 'serving-trays', 'ledger', 'podium'],
  },
  {
    id: 'community-service',
    name: '邻里公共服务赛',
    venue: 'main-town',
    labels: ['镇公所领任务', '书院整理图书', '药庐分类物资', '茶庄茶歇', '码头协助装卸', '集市便民服务', '广场总结'],
    checkpoints: ['town-office', 'academy', 'herb-clinic', 'tea-house', 'old-dock', 'morning-market', 'plaza'],
    props: ['task-board', 'books', 'supply-crates', 'tea-table', 'cargo-crates', 'service-stall', 'summary-board'],
  },
  {
    id: 'cooking-craft',
    name: '厨艺与手作赛',
    venue: 'main-town',
    labels: ['集市集合', '食材采购', '工坊制作', '茶庄试味', '食肆决赛', '邻里评审', '广场颁奖'],
    checkpoints: ['morning-market', 'morning-market', 'workshop', 'tea-house', 'restaurant', 'restaurant', 'plaza'],
    props: ['baskets', 'ingredients', 'workbenches', 'tasting-table', 'cooking-stations', 'score-cards', 'podium'],
  },
  {
    id: 'relay-build',
    name: '团队接力建造赛',
    venue: 'trial-island',
    labels: ['码头集合登船', '赛道接力', '踏板运送', '庭院茶歇', '团队组装', '彩旗冲刺', '颁奖返程'],
    checkpoints: ['old-dock', 'island-track', 'island-bridge', 'island-courtyard', 'island-team-field', 'island-final', 'island-awards'],
    props: ['ferry', 'batons', 'color-tiles', 'tea-table', 'building-parts', 'finish-flags', 'podium'],
  },
];

export const dailyEventTemplates: DailyEventTemplate[] = configurations.map((config) => ({
  id: config.id,
  name: config.name,
  venue: config.venue,
  participantCount: 9,
  teamCount: 2,
  eliminationResult: 'spectator',
  stages: STAGE_IDS.map((id, index) => ({
    id,
    label: config.labels[index],
    endsAtMinute: STAGE_END_MINUTES[index],
    targetActive: STAGE_ACTIVE_COUNTS[index],
    checkpoints: [config.checkpoints[index]],
    props: [config.props[index]],
    choices: Object.freeze(
      STAGE_CHOICES[index].map((choice) => Object.freeze({ ...choice })),
    ),
  })),
}));
