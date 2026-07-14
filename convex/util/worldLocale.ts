import { WorldLocale } from '../../data/worlds/lighthouse-town/manifest';

export function getWorldLocale(
  env: Record<string, string | undefined> = process.env,
): WorldLocale {
  return env.WORLD_LOCALE === 'en' ? 'en' : 'zh-CN';
}
