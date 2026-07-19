import { rendererShouldRun } from './rendererRuntime';

describe('paused and hidden renderer load shedding', () => {
  test('runs animation only for a visible, running world', () => {
    expect(rendererShouldRun('running', 'visible')).toBe(true);
    expect(rendererShouldRun('stoppedByDeveloper', 'visible')).toBe(false);
    expect(rendererShouldRun('inactive', 'visible')).toBe(false);
    expect(rendererShouldRun('running', 'hidden')).toBe(false);
    expect(rendererShouldRun(undefined, 'visible')).toBe(false);
  });
});
