export const goods = [
  { id: 'meal', name: '餐食', price: 6 },
  { id: 'tea', name: '茶点', price: 4 },
  { id: 'medicine', name: '常用药', price: 10 },
  { id: 'daily-goods', name: '日用品', price: 8 },
  { id: 'craft-service', name: '工艺服务', price: 12 },
] as const;

export type GoodId = (typeof goods)[number]['id'];

export const services = [
  { id: 'tower-guidance', name: '历史高塔讲解', counterName: '历史高塔讲解完成次数' },
  { id: 'teaching', name: '书院授课', counterName: '书院授课完成次数' },
  { id: 'ferry', name: '内河摆渡', counterName: '内河摆渡完成次数' },
  { id: 'repair', name: '器具维修', counterName: '器具维修完成次数' },
  { id: 'lantern-making', name: '灯笼制作', counterName: '灯笼制作完成次数' },
  { id: 'delivery', name: '集市配送', counterName: '集市配送完成次数' },
  { id: 'consultation', name: '民俗咨询', counterName: '民俗咨询完成次数' },
] as const;

export type ServiceId = (typeof services)[number]['id'];

export type InstitutionDefinition = {
  id: string;
  landmarkId: string;
  name: string;
  goods: readonly GoodId[];
  serviceIds: readonly ServiceId[];
};

export const institutions = [
  {
    id: 'academy',
    landmarkId: 'academy',
    name: '灯塔书院',
    goods: [],
    serviceIds: ['teaching'],
  },
  {
    id: 'herb-clinic',
    landmarkId: 'herb-clinic',
    name: '白露药庐',
    goods: ['medicine'],
    serviceIds: [],
  },
  {
    id: 'old-dock',
    landmarkId: 'old-dock',
    name: '旧水码头',
    goods: ['craft-service'],
    serviceIds: ['ferry'],
  },
  {
    id: 'divination-hall',
    landmarkId: 'divination-hall',
    name: '时和卦馆',
    goods: ['craft-service'],
    serviceIds: ['consultation'],
  },
  {
    id: 'tea-house',
    landmarkId: 'tea-house',
    name: '听雨茶庄',
    goods: ['tea'],
    serviceIds: [],
  },
  {
    id: 'morning-market',
    landmarkId: 'morning-market',
    name: '晨雾集市',
    goods: ['daily-goods', 'meal'],
    serviceIds: ['delivery'],
  },
  {
    id: 'town-office',
    landmarkId: 'town-office',
    name: '镇公所',
    goods: [],
    serviceIds: ['tower-guidance'],
  },
  {
    id: 'workshop',
    landmarkId: 'workshop',
    name: '苏氏机关坊',
    goods: ['craft-service'],
    serviceIds: ['repair', 'lantern-making'],
  },
  {
    id: 'restaurant',
    landmarkId: 'restaurant',
    name: '河鲜食肆',
    goods: ['meal'],
    serviceIds: [],
  },
] as const satisfies readonly InstitutionDefinition[];

export type InstitutionId = (typeof institutions)[number]['id'];
export type EmploymentKind = 'employee' | 'self-employed';
export type Compensation =
  | { kind: 'wage'; amount: number; cashCapped: true }
  | { kind: 'owner-draw'; amount: number; cashCapped: true }
  | { kind: 'contract-share'; amount: number; cashCapped: true };
export type WorkOutput =
  | { kind: 'stock'; item: GoodId; quantity: number }
  | { kind: 'service'; serviceId: ServiceId; quantity: number };

export type ResidentEconomyProfile = {
  id: string;
  name: string;
  occupation: string;
  institutionId: InstitutionId;
  employment: EmploymentKind;
  startingBalance: number;
  compensation: Compensation;
  workOutput: WorkOutput;
  workplaceNote?: string;
};

// These profiles are settlement capabilities and initial conditions. Residents still choose
// activities dynamically; a profile does not prescribe a fixed daily script.
export const residentEconomyProfiles: readonly ResidentEconomyProfile[] = [
  {
    id: 'lin-lan',
    name: '林澜',
    occupation: '历史高塔守望人',
    institutionId: 'town-office',
    employment: 'employee',
    startingBalance: 120,
    compensation: { kind: 'wage', amount: 12, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'tower-guidance', quantity: 1 },
  },
  {
    id: 'shen-yan',
    name: '沈砚',
    occupation: '书院先生',
    institutionId: 'academy',
    employment: 'employee',
    startingBalance: 132,
    compensation: { kind: 'wage', amount: 14, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'teaching', quantity: 1 },
  },
  {
    id: 'tang-guo',
    name: '唐果',
    occupation: '茶庄主人',
    institutionId: 'tea-house',
    employment: 'self-employed',
    startingBalance: 150,
    compensation: { kind: 'owner-draw', amount: 16, cashCapped: true },
    workOutput: { kind: 'stock', item: 'tea', quantity: 3 },
  },
  {
    id: 'mo-qi',
    name: '墨七',
    occupation: '内河摆渡人',
    institutionId: 'old-dock',
    employment: 'self-employed',
    startingBalance: 125,
    compensation: { kind: 'owner-draw', amount: 13, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'ferry', quantity: 1 },
  },
  {
    id: 'su-ying',
    name: '苏萤',
    occupation: '机关匠人',
    institutionId: 'workshop',
    employment: 'self-employed',
    startingBalance: 118,
    compensation: { kind: 'owner-draw', amount: 15, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'repair', quantity: 1 },
  },
  {
    id: 'bai-lu',
    name: '白露',
    occupation: '药庐医师',
    institutionId: 'herb-clinic',
    employment: 'self-employed',
    startingBalance: 142,
    compensation: { kind: 'owner-draw', amount: 16, cashCapped: true },
    workOutput: { kind: 'stock', item: 'medicine', quantity: 2 },
  },
  {
    id: 'gu-chao',
    name: '顾潮',
    occupation: '灯笼匠人',
    institutionId: 'workshop',
    employment: 'self-employed',
    startingBalance: 110,
    compensation: { kind: 'contract-share', amount: 14, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'lantern-making', quantity: 2 },
    workplaceNote: '与苏萤共享工位和工具，独立接单并按合作订单分成，不是苏氏机关坊的雇员。',
  },
  {
    id: 'a-man',
    name: '阿满',
    occupation: '集市跑腿兼船手',
    institutionId: 'morning-market',
    employment: 'employee',
    startingBalance: 82,
    compensation: { kind: 'wage', amount: 10, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'delivery', quantity: 1 },
  },
  {
    id: 'xuan-wei',
    name: '玄微先生',
    occupation: '卦馆卜算师',
    institutionId: 'divination-hall',
    employment: 'self-employed',
    startingBalance: 128,
    compensation: { kind: 'owner-draw', amount: 13, cashCapped: true },
    workOutput: { kind: 'service', serviceId: 'consultation', quantity: 1 },
  },
] as const;
