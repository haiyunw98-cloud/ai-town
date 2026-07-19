import { readFileSync } from 'node:fs';

describe('TownLandmarks interactions', () => {
  const landmarks = readFileSync(new URL('./TownLandmarks.tsx', import.meta.url), 'utf8');
  const game = readFileSync(new URL('./Game.tsx', import.meta.url), 'utf8');

  test('opens details without letting a place click become a world movement action', () => {
    expect(landmarks).toContain('event.stopPropagation()');
    expect(landmarks).toContain('onpointertap');
    expect(game).toContain('<InstitutionDetails');
    expect(game).toContain("setSidebarTab('institution')");
  });

  test('keeps an HTML keyboard-accessible directory and restores the previous observer tab on close', () => {
    expect(game).toContain('aria-label={`查看${landmark.name}机构详情`}');
    expect(game).toContain('previousSidebarTab');
    expect(game).toContain('closeInstitutionDetails');
  });
});
