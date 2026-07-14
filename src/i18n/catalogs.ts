const english = {
  'app.title': 'Lighthouse Town',
  'app.tagline': 'A Jiangnan fantasy town where AI residents live, remember, and socialize.',
  'language.switchToEnglish': 'Switch to English',
  'language.switchToChinese': '切换为中文',
  'language.english': 'English',
  'language.chinese': '中文',
  'town.capacity': 'Lighthouse Town supports up to {count} players at a time.',
  'test.englishOnly': 'English fallback',
} as const;

export type MessageKey = keyof typeof english;
type Catalog = Record<MessageKey, string | undefined>;

const simplifiedChinese: Catalog = {
  'app.title': '灯塔镇',
  'app.tagline': '一座由 AI 居民生活、记忆与交往的江南幻想小镇。',
  'language.switchToEnglish': '切换为英文',
  'language.switchToChinese': '切换为中文',
  'language.english': 'English',
  'language.chinese': '中文',
  'town.capacity': '灯塔镇最多同时容纳 {count} 位玩家。',
  'test.englishOnly': undefined,
};

export const catalogs = {
  en: english,
  'zh-CN': simplifiedChinese,
} satisfies Record<'en' | 'zh-CN', Catalog>;
