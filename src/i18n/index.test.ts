import { catalogs } from './catalogs';
import { formatMessage, normalizeLocale } from './index';
import { readFileSync } from 'node:fs';

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

  test('names the permanent observer tab without advertising a live event', () => {
    expect(formatMessage('zh-CN', 'event.broadcast')).toBe('小镇观察');
    expect(formatMessage('en', 'event.broadcast')).toBe('Town Observer');
  });

  test('player-facing components do not contain known English JSX literals', () => {
    const files = [
      '../App.tsx',
      '../components/FreezeButton.tsx',
      '../components/Messages.tsx',
      '../components/PlayerDetails.tsx',
      '../components/buttons/InteractButton.tsx',
      '../components/buttons/MusicButton.tsx',
    ];
    const forbidden = [
      'Help',
      'Start conversation',
      'Leave conversation',
      'typing...',
      'Walking over...',
      'Accept',
      'Reject',
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const literal of forbidden) {
        expect(source).not.toContain(`>${literal}<`);
      }
    }
  });
});
