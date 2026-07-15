export type LifeStats = {
  mood: number;
  energy: number;
  health: number;
  finance: number;
  reputation: number;
  social: number;
};

export type RelationKind = 'friendship' | 'crush' | 'dating' | 'business';

export type ResidentRelation = {
  targetId: string;
  kind: RelationKind;
  score: number;
  label: string;
  summary: string;
};

export type ResidentLifeProfile = {
  id: string;
  name: string;
  age: number;
  occupation: string;
  home: string;
  personality: string[];
  outfit: string;
  diet: string;
  business: string;
  currentGoal: string;
  baseStats: LifeStats;
  photos: string[];
  relationships: ResidentRelation[];
  recentHighlights: string[];
};

const photoSet = (id: string) => ['portrait', 'work', 'life', 'social'].map(
  (scene) => `/ai-town/assets/worlds/lighthouse-town/residents/${id}/${scene}.webp`,
);

export const residentLifeProfiles: ResidentLifeProfile[] = [
  {
    id: 'lin-lan',
    name: '林澜',
    age: 26,
    occupation: '灯塔守望人',
    home: '灯塔东侧守望人小屋',
    personality: ['温和', '谨慎', '责任感强', '慢热'],
    outfit: '黛青短褂、米白长裙与铜扣防潮披肩',
    diet: '偏爱清淡鱼汤、莲子羹和唐果泡的晚茶',
    business: '领取镇公所守塔薪金，也替船户校对雾潮时刻',
    currentGoal: '补全十三夜灯光异常记录，并让夜间航标保持可靠',
    baseStats: { mood: 72, energy: 66, health: 82, finance: 58, reputation: 88, social: 63 },
    photos: photoSet('lin-lan'),
    relationships: [
      { targetId: 'su-ying', kind: 'friendship', score: 91, label: '挚友', summary: '一起检查灯塔机械，能安静地陪伴彼此。' },
      { targetId: 'tang-guo', kind: 'friendship', score: 84, label: '像姐妹', summary: '夜班后总能在茶馆得到一壶热茶和可靠的倾听。' },
      { targetId: 'mo-qi', kind: 'business', score: 76, label: '航标协作', summary: '互换雾潮、航线与灯号记录。' },
    ],
    recentHighlights: ['更换了灯塔西窗的防潮纸', '连续记录到三次朝内陆的异常闪光'],
  },
  {
    id: 'shen-yan',
    name: '沈砚',
    age: 34,
    occupation: '云溪书院先生',
    home: '书院后院的藏书阁偏房',
    personality: ['博闻', '克制', '讲证据', '温柔固执'],
    outfit: '墨灰长衫、窄袖外褂与随身旧皮书袋',
    diet: '常忘记正餐，喜欢桂花糕、清茶与夜读时的温粥',
    business: '书院束脩、代写碑文并为商铺整理旧契',
    currentGoal: '找齐镇志缺页，查明“无海航路”指向何处',
    baseStats: { mood: 64, energy: 55, health: 70, finance: 61, reputation: 90, social: 58 },
    photos: photoSet('shen-yan'),
    relationships: [
      { targetId: 'tang-guo', kind: 'crush', score: 74, label: '彼此欣赏', summary: '他总以查资料为由多留一盏茶，尚未明说心意。' },
      { targetId: 'mo-qi', kind: 'friendship', score: 82, label: '求证搭档', summary: '一个认旧字，一个认旧水路，常把传闻查到实处。' },
      { targetId: 'xuan-wei', kind: 'friendship', score: 67, label: '论辩之交', summary: '常争论征兆算不算证据，却都尊重对方的边界。' },
      { targetId: 'tang-guo', kind: 'business', score: 69, label: '茶馆账本顾问', summary: '替茶馆辨认旧账与地方掌故，报酬多半是点心。' },
    ],
    recentHighlights: ['从茶馆口述中锁定了三号巷口', '把镇志残页重新按水位年份排序'],
  },
  {
    id: 'tang-guo',
    name: '唐果',
    age: 30,
    occupation: '临桥茶馆主人',
    home: '临桥茶馆二楼临水房',
    personality: ['爽朗', '细心', '会照顾人', '守口如瓶'],
    outfit: '朱砂色交领衫、靛蓝围裙与桂花纹发带',
    diet: '爱试新茶点，早餐固定吃咸豆花和脆萝卜',
    business: '经营茶馆、订制茶礼，并替街坊撮合可靠的小买卖',
    currentGoal: '让茶馆在淡季也有盈余，并查清雾夜后门的敲门人',
    baseStats: { mood: 81, energy: 74, health: 79, finance: 77, reputation: 92, social: 94 },
    photos: photoSet('tang-guo'),
    relationships: [
      { targetId: 'shen-yan', kind: 'crush', score: 78, label: '含蓄好感', summary: '会特意留下他喜欢的糕点，也珍惜那些不急着说破的谈话。' },
      { targetId: 'lin-lan', kind: 'friendship', score: 86, label: '像姐妹', summary: '熟悉林澜的夜班作息，总替她留着热茶。' },
      { targetId: 'bai-lu', kind: 'business', score: 88, label: '茶方合伙', summary: '共同推出时令草本茶，收益按月结算。' },
      { targetId: 'xuan-wei', kind: 'business', score: 65, label: '节气活动', summary: '请玄微先生讲节气民俗，但不允许他吓唬客人。' },
    ],
    recentHighlights: ['新做的桂花糕在午后售罄', '把三号巷的水位闲话记进了账本夹页'],
  },
  {
    id: 'mo-qi',
    name: '墨七',
    age: 36,
    occupation: '摆渡人',
    home: '旧码头旁的船屋',
    personality: ['寡言', '可靠', '方向感强', '外冷内热'],
    outfit: '深青防水短打、草编斗笠与磨旧的皮护腕',
    diet: '喜欢热汤面、腌鱼和白露配的驱寒茶',
    business: '经营摆渡、短途货运和雾天安全引航',
    currentGoal: '画出雾中不存在于官图的水道，同时带好阿满',
    baseStats: { mood: 68, energy: 78, health: 88, finance: 70, reputation: 89, social: 52 },
    photos: photoSet('mo-qi'),
    relationships: [
      { targetId: 'bai-lu', kind: 'dating', score: 87, label: '稳定交往', summary: '不爱公开秀恩爱，但每次夜航都会先去百草铺报平安。' },
      { targetId: 'a-man', kind: 'friendship', score: 83, label: '师徒情谊', summary: '嘴上严格，实际上把最安全的航线都教给了阿满。' },
      { targetId: 'shen-yan', kind: 'friendship', score: 82, label: '求证搭档', summary: '为沈砚标出旧码头，也请他辨认船板上的旧刻字。' },
      { targetId: 'lin-lan', kind: 'business', score: 76, label: '航标协作', summary: '按灯塔信号调整雾天摆渡时段。' },
    ],
    recentHighlights: ['夜航时发现一条回到原桥的怪水道', '给阿满重新示范了逆流靠岸'],
  },
  {
    id: 'su-ying',
    name: '苏萤',
    age: 28,
    occupation: '机关工坊匠人',
    home: '水车工坊楼上的小阁间',
    personality: ['聪明', '好奇', '务实', '胜负心强'],
    outfit: '青绿色窄袖工装、护目镜、黄铜工具腰带',
    diet: '忙起来只吃饭团，空闲时爱吃烤鱼和甜酒酿',
    business: '维修灯具水车，承接安全机关与船灯改造',
    currentGoal: '理解灯塔底层罗盘，并让工坊接单不再全靠熟人',
    baseStats: { mood: 76, energy: 83, health: 77, finance: 73, reputation: 85, social: 70 },
    photos: photoSet('su-ying'),
    relationships: [
      { targetId: 'lin-lan', kind: 'friendship', score: 91, label: '挚友', summary: '林澜负责记录，苏萤负责拆解，是最默契的灯塔搭档。' },
      { targetId: 'gu-chao', kind: 'crush', score: 81, label: '互有心动', summary: '总把约会说成比试，双方都还没正式挑明。' },
      { targetId: 'gu-chao', kind: 'business', score: 84, label: '灯具联合制作', summary: '一个做结构一个调光色，争执很多，成品也最好。' },
      { targetId: 'xuan-wei', kind: 'business', score: 62, label: '罗盘委托', summary: '替卦馆修铜罗盘，坚持先排除机械故障。' },
    ],
    recentHighlights: ['拆开灯塔底座时发现会自转的铜盘', '与顾潮共同完成一盏抗风船灯'],
  },
  {
    id: 'bai-lu',
    name: '白露',
    age: 32,
    occupation: '百草铺医师',
    home: '百草铺后院药圃旁',
    personality: ['冷静', '体贴', '有原则', '观察细致'],
    outfit: '月白交领衣、浅灰药囊与便于采药的软底靴',
    diet: '按时吃饭，偏爱山菌炖鸡、清粥与微苦花茶',
    business: '经营百草铺、看常见病伤并供应时令草药',
    currentGoal: '找回月白藤，弄清雾潮为何改变药草气味',
    baseStats: { mood: 75, energy: 71, health: 91, finance: 75, reputation: 95, social: 69 },
    photos: photoSet('bai-lu'),
    relationships: [
      { targetId: 'mo-qi', kind: 'dating', score: 89, label: '稳定交往', summary: '理解墨七的沉默，也会认真检查每次夜航留下的旧伤。' },
      { targetId: 'tang-guo', kind: 'business', score: 88, label: '茶方合伙', summary: '负责草本配伍和禁忌说明，唐果负责口味与销售。' },
      { targetId: 'a-man', kind: 'friendship', score: 75, label: '采药伙伴', summary: '教他辨认河岸药草，也管着他别冒险攀崖。' },
    ],
    recentHighlights: ['发现月白藤只在灯塔内闪时逆光开花', '为夜航船手备好了新的防寒药包'],
  },
  {
    id: 'gu-chao',
    name: '顾潮',
    age: 29,
    occupation: '长明灯笼坊匠人',
    home: '灯笼坊临街阁楼',
    personality: ['爽快', '好胜', '有感染力', '重承诺'],
    outfit: '赭红短袍、黑色绑腿与常沾金粉的工作围腰',
    diet: '爱辣鱼锅、芝麻烧饼和比赛结束后的冰甜汤',
    business: '制作节庆花灯，维护水巷灯火并承接商铺招牌灯',
    currentGoal: '做完灯塔节新灯组，查清沿河灯架为何自行转向',
    baseStats: { mood: 85, energy: 88, health: 84, finance: 76, reputation: 81, social: 86 },
    photos: photoSet('gu-chao'),
    relationships: [
      { targetId: 'su-ying', kind: 'crush', score: 83, label: '互有心动', summary: '喜欢用比赛吸引她注意，真正危险时却总先护住她。' },
      { targetId: 'su-ying', kind: 'business', score: 84, label: '灯具联合制作', summary: '共同接下高难度花灯与船灯订单。' },
      { targetId: 'tang-guo', kind: 'friendship', score: 72, label: '点子听众', summary: '新点子往往先在茶馆宣布，也听得进唐果的现实建议。' },
    ],
    recentHighlights: ['八盏新花灯已完成六盏', '无风时亲眼看见灯火同时朝向灯塔'],
  },
  {
    id: 'a-man',
    name: '阿满',
    age: 22,
    occupation: '鱼市跑腿兼船手',
    home: '鱼市西侧合租小院',
    personality: ['机灵', '勤快', '冲动', '讲义气'],
    outfit: '紫灰短打、卷起的裤脚与装满绳结的小挎包',
    diet: '饭量大，最爱鱼丸汤、葱油饼和唐果给的边角糕',
    business: '替鱼市与各家铺子送货，空闲时承接近岸搬运',
    currentGoal: '独立完成夜航，攒钱买一条自己的小货船',
    baseStats: { mood: 87, energy: 92, health: 90, finance: 43, reputation: 68, social: 82 },
    photos: photoSet('a-man'),
    relationships: [
      { targetId: 'mo-qi', kind: 'friendship', score: 83, label: '师徒情谊', summary: '敬佩墨七，也在努力学会先判断再行动。' },
      { targetId: 'bai-lu', kind: 'friendship', score: 75, label: '采药伙伴', summary: '常替她跑河岸，也会被她盯着处理小伤。' },
      { targetId: 'tang-guo', kind: 'business', score: 78, label: '茶馆配送', summary: '每天替茶馆送冰、鲜果和临时采购。' },
    ],
    recentHighlights: ['从旧水道捞回装有金色贝壳的蓝布包', '第一次独立完成了雨后清晨配送'],
  },
  {
    id: 'xuan-wei',
    name: '玄微先生',
    age: 41,
    occupation: '听潮卦馆卜算师',
    home: '三号巷外的听潮卦馆后屋',
    personality: ['从容', '洞察敏锐', '尊重边界', '略带神秘'],
    outfit: '玄紫长衫、暗金云纹外褂与铜罗盘腰佩',
    diet: '午前只饮淡茶，晚饭偏爱素面、笋干和一小杯黄酒',
    business: '替居民择日、解梦、看铺面布局，也售不夸大功效的节气历',
    currentGoal: '让卦馆稳定经营，并查明罗盘指向灯塔倒影的原因',
    baseStats: { mood: 69, energy: 64, health: 78, finance: 66, reputation: 73, social: 71 },
    photos: photoSet('xuan-wei'),
    relationships: [
      { targetId: 'shen-yan', kind: 'friendship', score: 67, label: '论辩之交', summary: '彼此质疑方法，却愿意一起检查可验证的异常。' },
      { targetId: 'tang-guo', kind: 'business', score: 65, label: '节气活动', summary: '在茶馆讲民俗与节气，坚持不靠恐吓招揽客人。' },
      { targetId: 'su-ying', kind: 'business', score: 62, label: '罗盘委托', summary: '接受先修机械再谈征兆的做法。' },
    ],
    recentHighlights: ['连续三夜起得同一卦象', '请苏萤检查了忽然偏转的铜罗盘'],
  },
];

export function getLifeProfileByName(name: string) {
  return residentLifeProfiles.find((profile) => profile.name === name);
}

export function getLifeProfileById(id: string) {
  return residentLifeProfiles.find((profile) => profile.id === id);
}
