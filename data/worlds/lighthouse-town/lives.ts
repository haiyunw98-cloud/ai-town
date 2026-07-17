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
    business: '领取镇公所文保薪金，也负责售票、讲解和广场巡查',
    currentGoal: '修好二层漏雨窗框，并争取落实周末讲解补贴',
    baseStats: { mood: 72, energy: 66, health: 82, finance: 58, reputation: 88, social: 63 },
    photos: photoSet('lin-lan'),
    relationships: [
      { targetId: 'su-ying', kind: 'friendship', score: 91, label: '挚友', summary: '一起维修高塔门窗，能安静地陪伴彼此。' },
      { targetId: 'tang-guo', kind: 'friendship', score: 84, label: '像姐妹', summary: '夜班后总能在茶馆得到一壶热茶和可靠的倾听。' },
      { targetId: 'mo-qi', kind: 'business', score: 76, label: '团体参观', summary: '为摆渡客团预约高塔讲解，按月核对团体票。' },
    ],
    recentHighlights: ['更换了高塔西窗的防雨纸', '周末讲解收到十二条好评'],
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
    currentGoal: '备好下月识字课，并攒钱添置一套学生共用字典',
    baseStats: { mood: 64, energy: 55, health: 70, finance: 61, reputation: 90, social: 58 },
    photos: photoSet('shen-yan'),
    relationships: [
      { targetId: 'tang-guo', kind: 'crush', score: 74, label: '彼此欣赏', summary: '他总以查资料为由多留一盏茶，尚未明说心意。' },
      { targetId: 'mo-qi', kind: 'friendship', score: 82, label: '乡土课搭档', summary: '一个讲旧字，一个讲河埠生活，共同准备水乡乡土课。' },
      { targetId: 'xuan-wei', kind: 'friendship', score: 67, label: '论辩之交', summary: '常讨论民俗该如何准确讲解，也尊重对方的边界。' },
      { targetId: 'tang-guo', kind: 'business', score: 69, label: '茶馆账本顾问', summary: '替茶馆辨认旧账与地方掌故，报酬多半是点心。' },
    ],
    recentHighlights: ['为三家商铺整理了旧契范本', '学生的月末识字测验全部进步'],
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
    currentGoal: '推出两款平价夏茶，并把糕点损耗控制在一成以内',
    baseStats: { mood: 81, energy: 74, health: 79, finance: 77, reputation: 92, social: 94 },
    photos: photoSet('tang-guo'),
    relationships: [
      { targetId: 'shen-yan', kind: 'crush', score: 78, label: '含蓄好感', summary: '会特意留下他喜欢的糕点，也珍惜那些不急着说破的谈话。' },
      { targetId: 'lin-lan', kind: 'friendship', score: 86, label: '像姐妹', summary: '熟悉林澜的夜班作息，总替她留着热茶。' },
      { targetId: 'bai-lu', kind: 'business', score: 88, label: '茶方合伙', summary: '共同推出时令草本茶，收益按月结算。' },
      { targetId: 'xuan-wei', kind: 'business', score: 65, label: '节气活动', summary: '请玄微先生讲节气民俗，但不允许他吓唬客人。' },
    ],
    recentHighlights: ['新做的桂花糕在午后售罄', '谈妥了下月莲子与茶叶的进货价'],
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
    business: '经营内河摆渡、短途货运和雨天预约接送',
    currentGoal: '更新雨季票价牌，并教会阿满稳妥靠岸与记账',
    baseStats: { mood: 68, energy: 78, health: 88, finance: 70, reputation: 89, social: 52 },
    photos: photoSet('mo-qi'),
    relationships: [
      { targetId: 'bai-lu', kind: 'dating', score: 87, label: '稳定交往', summary: '不爱公开秀恩爱，但每天收工都会先去百草铺报平安。' },
      { targetId: 'a-man', kind: 'friendship', score: 83, label: '师徒情谊', summary: '嘴上严格，实际上把各处安全靠岸方法都教给了阿满。' },
      { targetId: 'shen-yan', kind: 'friendship', score: 82, label: '求证搭档', summary: '为沈砚标出旧码头，也请他辨认船板上的旧刻字。' },
      { targetId: 'lin-lan', kind: 'business', score: 76, label: '团体参观', summary: '替外村客人预约高塔讲解，也帮忙运送展板。' },
    ],
    recentHighlights: ['雨后平稳送完两船菜货', '给阿满重新示范了逆流靠岸'],
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
    currentGoal: '修好茶馆水泵和三把农具，并为工坊争取两个新客户',
    baseStats: { mood: 76, energy: 83, health: 77, finance: 73, reputation: 85, social: 70 },
    photos: photoSet('su-ying'),
    relationships: [
      { targetId: 'lin-lan', kind: 'friendship', score: 91, label: '挚友', summary: '林澜报修门窗，苏萤负责维护，是最默契的文保搭档。' },
      { targetId: 'gu-chao', kind: 'crush', score: 81, label: '互有心动', summary: '总把约会说成比试，双方都还没正式挑明。' },
      { targetId: 'gu-chao', kind: 'business', score: 84, label: '灯具联合制作', summary: '一个做结构一个调光色，争执很多，成品也最好。' },
      { targetId: 'xuan-wei', kind: 'business', score: 62, label: '挂钟委托', summary: '替卦馆维修旧挂钟，并按约定工期交付。' },
    ],
    recentHighlights: ['修好了茶馆反复漏水的水泵', '与顾潮共同完成一盏省油店灯'],
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
    currentGoal: '补足夏季常用药材，并完善草本茶的禁忌说明',
    baseStats: { mood: 75, energy: 71, health: 91, finance: 75, reputation: 95, social: 69 },
    photos: photoSet('bai-lu'),
    relationships: [
      { targetId: 'mo-qi', kind: 'dating', score: 89, label: '稳定交往', summary: '理解墨七的沉默，也会认真检查摆渡劳作留下的旧伤。' },
      { targetId: 'tang-guo', kind: 'business', score: 88, label: '茶方合伙', summary: '负责草本配伍和禁忌说明，唐果负责口味与销售。' },
      { targetId: 'a-man', kind: 'friendship', score: 75, label: '采药伙伴', summary: '教他辨认河岸药草，也管着他别冒险攀崖。' },
    ],
    recentHighlights: ['晒好一批新采的河岸艾草', '为摆渡船工备好了新的防雨药包'],
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
    currentGoal: '做完夏灯会新灯组，并把灯纸成本降低一成',
    baseStats: { mood: 85, energy: 88, health: 84, finance: 76, reputation: 81, social: 86 },
    photos: photoSet('gu-chao'),
    relationships: [
      { targetId: 'su-ying', kind: 'crush', score: 83, label: '互有心动', summary: '喜欢用比赛吸引她注意，真正危险时却总先护住她。' },
      { targetId: 'su-ying', kind: 'business', score: 84, label: '灯具联合制作', summary: '共同接下高难度花灯与船灯订单。' },
      { targetId: 'tang-guo', kind: 'friendship', score: 72, label: '点子听众', summary: '新点子往往先在茶馆宣布，也听得进唐果的现实建议。' },
    ],
    recentHighlights: ['八盏新花灯已完成六盏', '拿到了两家新铺子的招牌灯订单'],
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
    currentGoal: '独立跑完早市配送，并攒够小货船的首付款',
    baseStats: { mood: 87, energy: 92, health: 90, finance: 43, reputation: 68, social: 82 },
    photos: photoSet('a-man'),
    relationships: [
      { targetId: 'mo-qi', kind: 'friendship', score: 83, label: '师徒情谊', summary: '敬佩墨七，也在努力学会先判断再行动。' },
      { targetId: 'bai-lu', kind: 'friendship', score: 75, label: '采药伙伴', summary: '常替她跑河岸，也会被她盯着处理小伤。' },
      { targetId: 'tang-guo', kind: 'business', score: 78, label: '茶馆配送', summary: '每天替茶馆送冰、鲜果和临时采购。' },
    ],
    recentHighlights: ['按时结清了本月合租房钱', '第一次独立完成了雨后清晨配送'],
  },
  {
    id: 'xuan-wei',
    name: '玄微先生',
    age: 41,
    occupation: '时和卦馆卜算师',
    home: '三号巷外的时和卦馆后屋',
    personality: ['从容', '洞察敏锐', '尊重边界', '沉稳含蓄'],
    outfit: '玄紫长衫、暗金云纹外褂与铜罗盘腰佩',
    diet: '午前只饮淡茶，晚饭偏爱素面、笋干和一小杯黄酒',
    business: '替居民择日、解梦、看铺面布局，也售不夸大功效的节气历',
    currentGoal: '让卦馆稳定经营，并售出四十本实用节气历',
    baseStats: { mood: 69, energy: 64, health: 78, finance: 66, reputation: 73, social: 71 },
    photos: photoSet('xuan-wei'),
    relationships: [
      { targetId: 'shen-yan', kind: 'friendship', score: 67, label: '论辩之交', summary: '彼此质疑方法，却愿意一起核对民俗资料和措辞。' },
      { targetId: 'tang-guo', kind: 'business', score: 65, label: '节气活动', summary: '在茶馆讲民俗与节气，坚持不靠恐吓招揽客人。' },
      { targetId: 'su-ying', kind: 'business', score: 62, label: '挂钟委托', summary: '请她维修卦馆旧挂钟，并按报价及时付工钱。' },
    ],
    recentHighlights: ['节气讲座坐满了茶馆雅间', '请苏萤修好了走慢的旧挂钟'],
  },
];

export function getLifeProfileByName(name: string) {
  return residentLifeProfiles.find((profile) => profile.name === name);
}

export function getLifeProfileById(id: string) {
  return residentLifeProfiles.find((profile) => profile.id === id);
}
