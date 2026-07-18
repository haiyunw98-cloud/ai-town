import type { TownLandmarkId } from './map';
import {
  goods,
  institutions,
  residentEconomyProfiles,
  type GoodId,
  type InstitutionId,
  type WorkOutput,
} from './economy';

export const ACTIVITY_CATEGORIES = ['work', 'food', 'care', 'social', 'leisure'] as const;

export type ResidentActivity = {
  description: string;
  emoji: string;
  duration: number;
  category: (typeof ACTIVITY_CATEGORIES)[number];
  landmarkId: TownLandmarkId;
  economicAction?: EconomicAction;
};

export type EconomicAction =
  | { kind: 'work'; institutionId: InstitutionId; output: WorkOutput }
  | { kind: 'purchase'; institutionId: InstitutionId; goodId: GoodId; quantity: 1 }
  | { kind: 'rest' };

export type ActivityInstitutionState = {
  institutionId: string;
  cash: number;
  stock: Partial<Record<GoodId, number>>;
  serviceCounters?: Record<string, number>;
  open?: boolean;
};

export type ResidentActivityState = {
  hunger: number;
  energy: number;
  balance: number;
  institutions?: readonly ActivityInstitutionState[];
};

export type ResidentNeed = 'food' | 'rest';

export type FeasibleActivityView = {
  state: Pick<ResidentActivityState, 'hunger' | 'energy' | 'balance'>;
  needs: ResidentNeed[];
  criticalNeeds: ResidentNeed[];
  activities: ResidentActivity[];
};

type ResidentActivityTemplate = Omit<ResidentActivity, 'landmarkId'>;

export const residentActivities: Record<string, ResidentActivityTemplate[]> = {
  林澜: [
    {
      description: '正在历史高塔核对参观登记与维修清单',
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
      description: '在值房坐下歇一会儿并喝些温水',
      emoji: '🧣',
      duration: 45_000,
      category: 'care',
    },
    {
      description: '去临桥茶馆和唐果商量周末游客茶点',
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
      description: '放下书卷闭目休息片刻',
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
      description: '在后堂坐下歇脚并喝一杯温茶',
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
      description: '靠在船屋长凳上休息一阵',
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
      description: '放下工具活动肩背并安静休息',
      emoji: '🧰',
      duration: 50_000,
      category: 'care',
    },
    {
      description: '拿着新画的窗扣图去找林澜确认尺寸',
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
      description: '在百草铺称药配方并盘点夏季常用药材',
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
      description: '在药庐内室闭目小憩片刻',
      emoji: '🎒',
      duration: 50_000,
      category: 'care',
    },
    {
      description: '为收工后的墨七检查旧伤并换药',
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
      description: '在长明灯笼坊糊制夏灯会的新花灯',
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
      description: '停下手里的活坐在廊下休息',
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
      description: '在集市棚下坐着歇一会儿',
      emoji: '🪢',
      duration: 40_000,
      category: 'care',
    },
    {
      description: '缠着墨七请教雨天靠岸技巧并主动复述要点',
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
      description: '在时和卦馆为客人排节气日程并说明边界',
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
      description: '在安静的厢房里闭目养神',
      emoji: '🧭',
      duration: 45_000,
      category: 'care',
    },
    {
      description: '找沈砚讨论民俗说法如何准确表达并记下建议',
      emoji: '🗣️',
      duration: 85_000,
      category: 'social',
    },
    {
      description: '听着院内雨声独自推演一局铜钱卦',
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
    activities.map((activity) => {
      const landmarkId = residentActivityLandmarks[residentName][activity.category];
      const profile = residentEconomyProfiles.find((entry) => entry.name === residentName)!;
      let economicAction: EconomicAction | undefined;
      if (activity.category === 'work') {
        economicAction = {
          kind: 'work',
          institutionId: profile.institutionId,
          output: profile.workOutput,
        };
      } else if (activity.category === 'food') {
        economicAction = landmarkId === 'tea-house'
          ? { kind: 'purchase', institutionId: 'tea-house', goodId: 'tea', quantity: 1 }
          : { kind: 'purchase', institutionId: 'restaurant', goodId: 'meal', quantity: 1 };
      } else if (activity.category === 'care') {
        economicAction = { kind: 'rest' };
      }
      return { ...activity, landmarkId, economicAction };
    }),
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

export function feasibleActivitiesForState(
  residentName: string,
  state: ResidentActivityState,
): FeasibleActivityView {
  const needs: ResidentNeed[] = [];
  const criticalNeeds: ResidentNeed[] = [];
  if (state.hunger <= 30) needs.push('food');
  if (state.energy <= 30) needs.push('rest');
  if (state.hunger <= 10) criticalNeeds.push('food');
  if (state.energy <= 10) criticalNeeds.push('rest');
  const institutionStates = state.institutions === undefined
    ? undefined
    : new Map(state.institutions.map((entry) => [entry.institutionId, entry]));
  const activities = activitiesForResident(residentName).filter((activity) => {
    const action = activity.economicAction;
    if (!action || action.kind === 'rest') return true;
    const institution = institutions.find((entry) => entry.id === action.institutionId);
    if (!institution) return false;
    const runtime = institutionStates?.get(action.institutionId);
    if (institutionStates && (!runtime || runtime.open === false)) return false;
    if (action.kind === 'purchase') {
      const good = goods.find((entry) => entry.id === action.goodId);
      if (!good || !(institution.goods as readonly string[]).includes(action.goodId)) return false;
      if (state.balance < good.price * action.quantity) return false;
      return runtime === undefined || (runtime.stock[action.goodId] ?? 0) >= action.quantity;
    }
    const output = action.output;
    if (output.kind === 'stock') {
      const current = runtime?.stock[output.item] ?? 0;
      return (institution.goods as readonly string[]).includes(output.item)
        && current + output.quantity <= 1_000_000;
    }
    const current = runtime?.serviceCounters?.[output.serviceId] ?? 0;
    return (institution.serviceIds as readonly string[]).includes(output.serviceId)
      && current + output.quantity <= 1_000_000;
  });
  return {
    state: { hunger: state.hunger, energy: state.energy, balance: state.balance },
    needs,
    criticalNeeds,
    activities,
  };
}
