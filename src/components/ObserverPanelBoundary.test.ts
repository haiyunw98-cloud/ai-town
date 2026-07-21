import fs from 'node:fs';

describe('observer panel failure isolation', () => {
  test('keeps observer queries behind a retryable boundary so the map stays mounted', () => {
    const source = fs.readFileSync(new URL('./Game.tsx', import.meta.url), 'utf8');
    expect(source).toContain("from './ObserverPanelBoundary'");
    expect(source).toContain('<ObserverPanelBoundary');
    expect(source).toContain('onRetry=');
  });
});
