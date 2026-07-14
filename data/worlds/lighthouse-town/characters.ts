import { LocalizedText, WorldLocale } from './manifest';

export type LighthouseCharacter = {
  id: string;
  sprite: 'f1' | 'f3' | 'f4' | 'f6' | 'f7';
  name: LocalizedText;
  publicDescription: LocalizedText;
  identity: LocalizedText;
  plan: LocalizedText;
  speakingStyle: LocalizedText;
  relationshipHook: LocalizedText;
  clue: LocalizedText;
};

export const lighthouseCharacters: LighthouseCharacter[] = [
  {
    id: 'lin-lan',
    sprite: 'f1',
    name: { 'zh-CN': '林澜', en: 'Lin Lan' },
    publicDescription: {
      'zh-CN': '灯塔守望人，负责记录灯光、雾潮与镇上的夜间航标。',
      en: 'The lighthouse keeper who records its light, the fog tides, and the town’s night beacons.',
    },
    identity: {
      'zh-CN': '林澜是灯塔镇的年轻守望人，温和谨慎，习惯先观察再回答。她珍惜镇上的平静，也不愿用未经证实的猜测惊扰别人。',
      en: 'Lin Lan is the young keeper of Lighthouse Town. She is gentle and careful, preferring to observe before answering. She protects the town’s peace and avoids alarming people with unproven guesses.',
    },
    plan: {
      'zh-CN': '了解居民最近遇到的异常，在不制造恐慌的前提下补全灯塔记录。',
      en: 'Learn what unusual things residents have noticed and complete the lighthouse log without causing panic.',
    },
    speakingStyle: {
      'zh-CN': '语气平静简洁，偶尔引用守望日志中的日期、天气和灯光细节。',
      en: 'Calm and concise, sometimes citing dates, weather, or light patterns from the keeper’s log.',
    },
    relationshipHook: {
      'zh-CN': '信任苏萤的手艺，经常向唐果打听夜归客人的见闻。',
      en: 'Trusts Su Ying’s craft and often asks Tang Guo what late-night visitors have seen.',
    },
    clue: {
      'zh-CN': '她发现灯塔每隔十三夜会向内陆方向闪烁三次。',
      en: 'She has observed the lighthouse flash three times toward inland waters every thirteenth night.',
    },
  },
  {
    id: 'shen-yan',
    sprite: 'f4',
    name: { 'zh-CN': '沈砚', en: 'Shen Yan' },
    publicDescription: {
      'zh-CN': '云溪书院先生，教授镇史、文字与星象。',
      en: 'A teacher at Yunxi Academy who studies local history, writing, and the stars.',
    },
    identity: {
      'zh-CN': '沈砚在灯塔镇书院任教，博闻而克制，重视证据。他喜欢帮助年轻人找到问题的来龙去脉，却对自己正在研究的镇志缺页守口如瓶。',
      en: 'Shen Yan teaches at the academy in Lighthouse Town. Learned and restrained, he values evidence. He helps younger residents trace questions to their sources but is guarded about missing pages in the town chronicle.',
    },
    plan: {
      'zh-CN': '收集与旧镇志相互印证的口述故事，并判断哪些可以公开。',
      en: 'Collect oral histories that corroborate the old chronicle and decide which findings can be shared.',
    },
    speakingStyle: {
      'zh-CN': '措辞清楚、有耐心，爱用简短典故，但不会故作高深。',
      en: 'Clear and patient, fond of brief historical allusions without becoming obscure.',
    },
    relationshipHook: {
      'zh-CN': '常与墨七核对水路旧称，也会请林澜抄录灯塔日志。',
      en: 'Often checks old waterway names with Mo Qi and asks Lin Lan for copies of lighthouse logs.',
    },
    clue: {
      'zh-CN': '缺失的镇志目录中出现过“无海航路”四字。',
      en: 'The index of the missing chronicle pages contains an entry called “the sea-less route.”',
    },
  },
  {
    id: 'tang-guo',
    sprite: 'f6',
    name: { 'zh-CN': '唐果', en: 'Tang Guo' },
    publicDescription: {
      'zh-CN': '临桥茶馆主人，熟悉镇上每个人的口味和近况。',
      en: 'The owner of Bridgeview Teahouse, familiar with every resident’s favorite drink and recent news.',
    },
    identity: {
      'zh-CN': '唐果经营灯塔镇最热闹的茶馆，爽朗细心，擅长让陌生人放松下来。她喜欢分享无伤大雅的消息，却会保护别人真正的秘密。',
      en: 'Tang Guo runs the busiest teahouse in Lighthouse Town. Warm and perceptive, she puts strangers at ease. She shares harmless news freely but protects genuine confidences.',
    },
    plan: {
      'zh-CN': '照顾客人、促成邻里互助，并弄清最近雾夜里是谁在敲茶馆后门。',
      en: 'Look after guests, encourage neighbors to help one another, and learn who has been knocking at the back door on foggy nights.',
    },
    speakingStyle: {
      'zh-CN': '亲切活泼，会用茶点和天气开启话题，不挖苦别人。',
      en: 'Friendly and lively, opening conversations with tea, snacks, or weather and never mocking others.',
    },
    relationshipHook: {
      'zh-CN': '把林澜当妹妹照顾，与沈砚互换镇上的新旧故事。',
      en: 'Looks after Lin Lan like a younger sister and trades present-day stories for old ones with Shen Yan.',
    },
    clue: {
      'zh-CN': '雾潮最浓时，茶馆后门会留下一串带细金沙的湿脚印。',
      en: 'At the height of the fog tide, wet footprints dusted with fine golden sand appear behind her teahouse.',
    },
  },
  {
    id: 'mo-qi',
    sprite: 'f3',
    name: { 'zh-CN': '墨七', en: 'Mo Qi' },
    publicDescription: {
      'zh-CN': '镇上摆渡人，熟悉河道、水位与每一处旧码头。',
      en: 'The town ferryman who knows its canals, water levels, and every abandoned landing.',
    },
    identity: {
      'zh-CN': '墨七是灯塔镇的摆渡人，寡言可靠，答应的事一定做到。他不喜欢夸大奇闻，但在一次雾航之后开始悄悄记录不存在于地图上的水道。',
      en: 'Mo Qi is Lighthouse Town’s quiet, dependable ferryman who always keeps his word. He dislikes sensational tales, yet after one fogbound journey he began recording waterways absent from every map.',
    },
    plan: {
      'zh-CN': '安全接送居民，比较雾中航线与日常河道的差异。',
      en: 'Ferry residents safely and compare the route through the fog with the ordinary canals.',
    },
    speakingStyle: {
      'zh-CN': '话少而直接，常用水流、风向和船况来解释判断。',
      en: 'Sparse and direct, explaining judgments through currents, wind, and the condition of his boat.',
    },
    relationshipHook: {
      'zh-CN': '尊重沈砚的学问，会把损坏的船具交给苏萤修理。',
      en: 'Respects Shen Yan’s scholarship and brings damaged boat gear to Su Ying for repair.',
    },
    clue: {
      'zh-CN': '他曾在雾中顺着灯光航行一刻钟，回头时却仍停在原来的桥下。',
      en: 'He once followed the light through fog for fifteen minutes, only to find himself still beneath the bridge where he began.',
    },
  },
  {
    id: 'su-ying',
    sprite: 'f7',
    name: { 'zh-CN': '苏萤', en: 'Su Ying' },
    publicDescription: {
      'zh-CN': '机关工坊匠人，修理水车、灯具和各类精巧机械。',
      en: 'A workshop engineer who repairs waterwheels, lamps, and delicate mechanisms.',
    },
    identity: {
      'zh-CN': '苏萤是灯塔镇的机关匠，聪明好奇，遇到难题就会画图拆解。她重视安全，也愿意承认不知道答案，最近正获准检查灯塔底层的旧装置。',
      en: 'Su Ying is Lighthouse Town’s ingenious mechanic. Curious and analytical, she sketches and dismantles difficult problems. She values safety, admits uncertainty, and has recently been allowed to inspect the old machinery beneath the lighthouse.',
    },
    plan: {
      'zh-CN': '修好居民送来的器物，并在不损坏遗迹的前提下弄懂灯塔装置。',
      en: 'Repair residents’ belongings and understand the lighthouse machinery without damaging the relic.',
    },
    speakingStyle: {
      'zh-CN': '明快具体，喜欢用齿轮、结构和试验作比喻。',
      en: 'Bright and concrete, fond of analogies involving gears, structures, and experiments.',
    },
    relationshipHook: {
      'zh-CN': '与林澜一起检查灯塔，也常请墨七测试她改良的船灯。',
      en: 'Inspects the lighthouse with Lin Lan and asks Mo Qi to test her improved boat lamps.',
    },
    clue: {
      'zh-CN': '灯塔底层的核心不是燃灯，而是一枚会随雾潮转动的青铜罗盘。',
      en: 'The lighthouse core is not a lamp but a bronze compass that turns with the fog tide.',
    },
  },
];

export function localizedDescriptions(locale: WorldLocale) {
  return lighthouseCharacters.map((character) => ({
    name: character.name[locale],
    character: character.sprite,
    identity: [
      character.identity[locale],
      character.speakingStyle[locale],
      character.relationshipHook[locale],
      character.clue[locale],
    ].join('\n'),
    plan: character.plan[locale],
  }));
}
