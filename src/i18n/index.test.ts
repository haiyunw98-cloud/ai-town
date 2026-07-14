import { catalogs } from './catalogs';
import { formatMessage, normalizeLocale } from './index';

describe('i18n', () => {
  test('catalogs contain the same keys', () => {
    expect(Object.keys(catalogs['zh-CN']).sort()).toEqual(Object.keys(catalogs.en).sort());
  });

  test('normalizes Chinese and English browser locales', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-SG')).toBe('zh-CN');
    expect(normalizeLocale('en-US')).toBe('en');
  });

  test('falls back to Simplified Chinese for unsupported locales', () => {
    expect(normalizeLocale('fr-FR')).toBe('zh-CN');
    expect(normalizeLocale(undefined)).toBe('zh-CN');
  });

  test('interpolates values without evaluating markup', () => {
    expect(formatMessage('zh-CN', 'town.capacity', { count: 8 })).toBe('灯塔镇最多同时容纳 8 位玩家。');
    expect(formatMessage('en', 'town.capacity', { count: '<b>8</b>' })).toBe(
      'Lighthouse Town supports up to <b>8</b> players at a time.',
    );
  });

  test('falls back to English when a Chinese value is unavailable', () => {
    expect(formatMessage('zh-CN', 'test.englishOnly')).toBe('English fallback');
  });
});
