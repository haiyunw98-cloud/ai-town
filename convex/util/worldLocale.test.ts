import { getWorldLocale } from './worldLocale';

describe('getWorldLocale', () => {
  test('uses Simplified Chinese by default', () => {
    expect(getWorldLocale({})).toBe('zh-CN');
  });

  test('accepts English explicitly', () => {
    expect(getWorldLocale({ WORLD_LOCALE: 'en' })).toBe('en');
  });

  test('falls back safely for unsupported values', () => {
    expect(getWorldLocale({ WORLD_LOCALE: 'ja' })).toBe('zh-CN');
  });
});
