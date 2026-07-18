export const goods = [
  { id: 'meal', name: '餐食', price: 6 },
  { id: 'tea', name: '茶点', price: 4 },
  { id: 'medicine', name: '常用药', price: 10 },
  { id: 'daily-goods', name: '日用品', price: 8 },
  { id: 'craft-service', name: '工艺服务', price: 12 },
] as const;

export type GoodId = (typeof goods)[number]['id'];

export type InstitutionDefinition = {
  id: string;
  landmarkId: string;
  name: string;
  goods: readonly GoodId[];
};

export const institutions = [
  { id: 'academy', landmarkId: 'academy', name: '灯塔书院', goods: [] },
  {
    id: 'herb-clinic',
    landmarkId: 'herb-clinic',
    name: '白露药庐',
    goods: ['medicine'],
  },
  {
    id: 'old-dock',
    landmarkId: 'old-dock',
    name: '旧水码头',
    goods: ['craft-service'],
  },
  {
    id: 'divination-hall',
    landmarkId: 'divination-hall',
    name: '时和卦馆',
    goods: ['craft-service'],
  },
  { id: 'tea-house', landmarkId: 'tea-house', name: '听雨茶庄', goods: ['tea'] },
  {
    id: 'morning-market',
    landmarkId: 'morning-market',
    name: '晨雾集市',
    goods: ['daily-goods', 'meal'],
  },
  { id: 'town-office', landmarkId: 'town-office', name: '镇公所', goods: [] },
  {
    id: 'workshop',
    landmarkId: 'workshop',
    name: '苏氏机关坊',
    goods: ['craft-service'],
  },
  { id: 'restaurant', landmarkId: 'restaurant', name: '河鲜食肆', goods: ['meal'] },
] as const satisfies readonly InstitutionDefinition[];

export type InstitutionId = (typeof institutions)[number]['id'];
export type EmploymentKind = 'employee' | 'self-employed';
export type WorkOutput = {
  item: GoodId | 'service';
  quantity: number;
};

export type ResidentEconomyProfile = {
  id: string;
  name: string;
  occupation: string;
  institutionId: InstitutionId;
  employment: EmploymentKind;
  startingBalance: number;
  workPay: number;
  workOutput: WorkOutput;
};

export const residentEconomyProfiles = [
  {
    id: 'lin-lan',
    name: '林澜',
    occupation: '历史高塔守望人',
    institutionId: 'town-office',
    employment: 'employee',
    startingBalance: 120,
    workPay: 12,
    workOutput: { item: 'service', quantity: 1 },
  },
  {
    id: 'shen-yan',
    name: '沈砚',
    occupation: '书院先生',
    institutionId: 'academy',
    employment: 'employee',
    startingBalance: 132,
    workPay: 14,
    workOutput: { item: 'service', quantity: 1 },
  },
  {
    id: 'tang-guo',
    name: '唐果',
    occupation: '茶庄主人',
    institutionId: 'tea-house',
    employment: 'self-employed',
    startingBalance: 150,
    workPay: 16,
    workOutput: { item: 'tea', quantity: 3 },
  },
  {
    id: 'mo-qi',
    name: '墨七',
    occupation: '内河摆渡人',
    institutionId: 'old-dock',
    employment: 'self-employed',
    startingBalance: 125,
    workPay: 13,
    workOutput: { item: 'service', quantity: 1 },
  },
  {
    id: 'su-ying',
    name: '苏萤',
    occupation: '机关匠人',
    institutionId: 'workshop',
    employment: 'self-employed',
    startingBalance: 118,
    workPay: 15,
    workOutput: { item: 'craft-service', quantity: 1 },
  },
  {
    id: 'bai-lu',
    name: '白露',
    occupation: '药庐医师',
    institutionId: 'herb-clinic',
    employment: 'self-employed',
    startingBalance: 142,
    workPay: 16,
    workOutput: { item: 'medicine', quantity: 2 },
  },
  {
    id: 'gu-chao',
    name: '顾潮',
    occupation: '灯笼匠人',
    institutionId: 'workshop',
    employment: 'self-employed',
    startingBalance: 110,
    workPay: 14,
    workOutput: { item: 'craft-service', quantity: 2 },
  },
  {
    id: 'a-man',
    name: '阿满',
    occupation: '集市跑腿兼船手',
    institutionId: 'morning-market',
    employment: 'employee',
    startingBalance: 82,
    workPay: 10,
    workOutput: { item: 'service', quantity: 1 },
  },
  {
    id: 'xuan-wei',
    name: '玄微先生',
    occupation: '卦馆卜算师',
    institutionId: 'divination-hall',
    employment: 'self-employed',
    startingBalance: 128,
    workPay: 13,
    workOutput: { item: 'service', quantity: 1 },
  },
] as const satisfies readonly ResidentEconomyProfile[];
