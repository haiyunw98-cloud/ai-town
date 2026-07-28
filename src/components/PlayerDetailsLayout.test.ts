import { readFileSync } from 'node:fs';

describe('PlayerDetails action layout', () => {
  test('conversation actions stay content-height inside the observer panel', () => {
    const source = readFileSync(new URL('./PlayerDetails.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

    expect(source).toContain('observer-action-button');
    expect(styles).toMatch(/\.observer-action-button\s*\{[^}]*display:\s*block;[^}]*height:\s*auto;/s);
    expect(styles).toMatch(/\.observer-action-button\s*>\s*div\s*\{[^}]*height:\s*auto;/s);
  });
});
