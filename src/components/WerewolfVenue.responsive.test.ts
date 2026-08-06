import { readFileSync } from 'node:fs';

describe('werewolf venue responsive styling', () => {
  test('has desktop, phone, reduced-motion and sound-control rules', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.werewolf-venue\s*\{/u);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.werewolf-round-table/u);
    expect(css).toMatch(/\.town-sound-control\s*\{/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.werewolf-/u);
  });
});
