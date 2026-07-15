import type { TownLandmarkId } from './map';

export const ACTIVITY_CATEGORIES = ['work', 'food', 'care', 'social', 'leisure'] as const;

export type ResidentActivity = {
  description: string;
  emoji: string;
  duration: number;
  category: (typeof ACTIVITY_CATEGORIES)[number];
  landmarkId: TownLandmarkId;
};

type ResidentActivityTemplate = Omit<ResidentActivity, 'landmarkId'>;

export const residentActivities: Record<string, ResidentActivityTemplate[]> = {
  林澜: [
    {
      description: '正在灯塔顶层校对雾潮与航标记录',
      emoji: '📜',
      duration: 90_000,
      category: 'work',
    },
    {
      description: '靠着守望台吃一碗热粥配酱菜',
      emoji: '🥣',
      duration: 50_000,
      category: 'food',
    },
    {
      description: '系紧靛青披风并整理随身的灯塔钥匙',
      emoji: '🧣',
      duration: 45_000,
      category: 'care',
    },
    {
      description: '去临桥茶馆问唐果夜归客人看见了什么',
      emoji: '🍵',
      duration: 80_000,
      category: 'social',
    },
    {
      description: '在高处静看运河上的薄雾与归舟',
      emoji: '🌫️',
      duration: 75_000,
      category: 'leisure',
    },
  ],
  沈砚: [
    {
      description: '在云溪书院整理镇志残页并备课',
      emoji: '📖',
      duration: 100_000,
      category: 'work',
    },
    {
      description: '就着清茶慢慢吃一块桂花糕',
      emoji: '🍵',
      duration: 45_000,
      category: 'food',
    },
    {
      description: '拂去长衫上的粉笔灰并理齐案头笔墨',
      emoji: '🧹',
      duration: 50_000,
      category: 'care',
    },
    {
      description: '找墨七核对老码头与水路的旧称',
      emoji: '🗺️',
      duration: 85_000,
      category: 'social',
    },
    {
      description: '在书院庭中观星并记下今夜方位',
      emoji: '🌟',
      duration: 90_000,
      category: 'leisure',
    },
  ],
  唐果: [
    {
      description: '在临桥茶馆招呼客人并盘点今日茶叶',
      emoji: '🍵',
      duration: 90_000,
      category: 'work',
    },
    {
      description: '试吃新出炉的桂花糕并调整甜度',
      emoji: '🧁',
      duration: 45_000,
      category: 'food',
    },
    {
      description: '理好靛蓝围裙和桂花纹发带后擦净茶桌',
      emoji: '🧣',
      duration: 55_000,
      category: 'care',
    },
    {
      description: '给林澜留一壶热茶并听她讲夜班见闻',
      emoji: '🫖',
      duration: 80_000,
      category: 'social',
    },
    {
      description: '打烊后倚着二楼窗栏听河上桨声',
      emoji: '🌙',
      duration: 70_000,
      category: 'leisure',
    },
  ],
  墨七: [
    {
      description: '驾着乌篷船做晨间摆渡并检查水位',
      emoji: '🛥️',
      duration: 100_000,
      category: 'work',
    },
    {
      description: '在船屋门口吃一碗鲜鱼热汤面',
      emoji: '🍜',
      duration: 55_000,
      category: 'food',
    },
    {
      description: '拧干深青短打的衣角并重绑皮护腕',
      emoji: '🧵',
      duration: 45_000,
      category: 'care',
    },
    {
      description: '带阿满练习逆流靠岸并讲解风向',
      emoji: '🧑‍✈️',
      duration: 95_000,
      category: 'social',
    },
    {
      description: '独坐旧码头磨绳结并听水声',
      emoji: '🪢',
      duration: 70_000,
      category: 'leisure',
    },
  ],
  苏萤: [
    {
      description: '在机关工坊拆检一盏故障船灯',
      emoji: '⚙️',
      duration: 105_000,
      category: 'work',
    },
    {
      description: '忙里偷闲吃一个烤鱼饭团',
      emoji: '🍙',
      duration: 40_000,
      category: 'food',
    },
    {
      description: '束好窄袖工装并按大小理顺黄铜工具',
      emoji: '🧰',
      duration: 50_000,
      category: 'care',
    },
    {
      description: '拿着新画的结构图去找林澜核对灯塔记录',
      emoji: '📐',
      duration: 85_000,
      category: 'social',
    },
    {
      description: '摆弄一只自制发条小鸟看它走直线',
      emoji: '🐦',
      duration: 65_000,
      category: 'leisure',
    },
  ],
  白露: [
    {
      description: '在百草铺称药配方并记录雾潮前的气味',
      emoji: '🌿',
      duration: 100_000,
      category: 'work',
    },
    {
      description: '按时吃一碗山菌清粥配微苦花茶',
      emoji: '🥣',
      duration: 55_000,
      category: 'food',
    },
    {
      description: '重新分门别类整理药囊并系紧软底靴',
      emoji: '🎒',
      duration: 50_000,
      category: 'care',
    },
    {
      description: '为夜航归来的墨七检查旧伤并换药',
      emoji: '🩹',
      duration: 80_000,
      category: 'social',
    },
    {
      description: '在后院药圃观察月白藤的花苞',
      emoji: '🌼',
      duration: 75_000,
      category: 'leisure',
    },
  ],
  顾潮: [
    {
      description: '在长明灯笼坊糊制灯塔节的新花灯',
      emoji: '🏮',
      duration: 105_000,
      category: 'work',
    },
    {
      description: '捧着热辣鱼汤就芝麻烧饼大口吃',
      emoji: '🍲',
      duration: 50_000,
      category: 'food',
    },
    {
      description: '拍掉赭红短袍上的金粉并重系工作围腰',
      emoji: '✨',
      duration: 45_000,
      category: 'care',
    },
    {
      description: '去机关工坊找苏萤比较谁的船灯更抗风',
      emoji: '🔥',
      duration: 90_000,
      category: 'social',
    },
    {
      description: '在水巷里试看新灯纸映出的光色',
      emoji: '🌈',
      duration: 70_000,
      category: 'leisure',
    },
  ],
  阿满: [
    {
      description: '在鱼市与河埠间飞快送完早晨货物',
      emoji: '🧺',
      duration: 85_000,
      category: 'work',
    },
    {
      description: '在摊边喝鱼丸汤并吃唐果留的边角糕',
      emoji: '🍢',
      duration: 45_000,
      category: 'food',
    },
    {
      description: '卷高裤脚并把小挎包里的绳结重新排好',
      emoji: '🪢',
      duration: 40_000,
      category: 'care',
    },
    {
      description: '缠着墨七请教夜航技巧并主动复述要点',
      emoji: '🛥️',
      duration: 80_000,
      category: 'social',
    },
    {
      description: '蹲在旧码头练习单手打船结',
      emoji: '🫡',
      duration: 60_000,
      category: 'leisure',
    },
  ],
  玄微先生: [
    {
      description: '在听潮卦馆为客人排节气日程并说明边界',
      emoji: '☷️',
      duration: 95_000,
      category: 'work',
    },
    {
      description: '午前静饮淡茶并吃一小碗笋干素面',
      emoji: '🍜',
      duration: 50_000,
      category: 'food',
    },
    {
      description: '抚平玄紫长衫并擦拭腰间的铜罗盘',
      emoji: '🧭',
      duration: 45_000,
      category: 'care',
    },
    {
      description: '找沈砚辩论征兆能否成为证据并记下分歧',
      emoji: '🗣️',
      duration: 85_000,
      category: 'social',
    },
    {
      description: '听着远处潮声独自推演一局铜钱卦',
      emoji: '🪙',
      duration: 75_000,
      category: 'leisure',
    },
  ],
};

const residentNameAliases: Record<string, string> = {
  'Lin Lan': '林澜',
  'Shen Yan': '沈砚',
  'Tang Guo': '唐果',
  'Mo Qi': '墨七',
  'Su Ying': '苏萤',
  'Bai Lu': '白露',
  'Gu Chao': '顾潮',
  'A Man': '阿满',
  'Master Xuanwei': '玄微先生',
};

const residentActivityLandmarks: Record<
  string,
  Record<(typeof ACTIVITY_CATEGORIES)[number], TownLandmarkId>
> = {
  林澜: { work: 'town-office', food: 'restaurant', care: 'morning-market', social: 'tea-house', leisure: 'old-dock' },
  沈砚: { work: 'academy', food: 'tea-house', care: 'morning-market', social: 'old-dock', leisure: 'academy' },
  唐果: { work: 'tea-house', food: 'restaurant', care: 'morning-market', social: 'tea-house', leisure: 'old-dock' },
  墨七: { work: 'old-dock', food: 'restaurant', care: 'morning-market', social: 'old-dock', leisure: 'old-dock' },
  苏萤: { work: 'workshop', food: 'restaurant', care: 'morning-market', social: 'town-office', leisure: 'workshop' },
  白露: { work: 'herb-clinic', food: 'restaurant', care: 'herb-clinic', social: 'herb-clinic', leisure: 'herb-clinic' },
  顾潮: { work: 'workshop', food: 'restaurant', care: 'morning-market', social: 'workshop', leisure: 'morning-market' },
  阿满: { work: 'morning-market', food: 'restaurant', care: 'morning-market', social: 'old-dock', leisure: 'old-dock' },
  玄微先生: { work: 'divination-hall', food: 'tea-house', care: 'morning-market', social: 'academy', leisure: 'divination-hall' },
};

const locatedResidentActivities = Object.fromEntries(
  Object.entries(residentActivities).map(([residentName, activities]) => [
    residentName,
    activities.map((activity) => ({
      ...activity,
      landmarkId: residentActivityLandmarks[residentName][activity.category],
    })),
  ]),
) as Record<string, ResidentActivity[]>;

export function activitiesForResident(residentName: string): ResidentActivity[] {
  const canonicalName = residentNameAliases[residentName] ?? residentName;
  return locatedResidentActivities[canonicalName] ?? locatedResidentActivities['林澜'];
}

export function pickResidentActivity(
  residentName: string,
  random: () => number = Math.random,
): ResidentActivity {
  const activities = activitiesForResident(residentName);
  const index = Math.min(Math.floor(random() * activities.length), activities.length - 1);
  return activities[index];
}
