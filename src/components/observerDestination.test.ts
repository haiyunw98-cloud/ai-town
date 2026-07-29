import { resolveObserverDestination } from './observerDestination';

describe('resolveObserverDestination', () => {
  test('accepts an integer tile in the main town', () => {
    expect(resolveObserverDestination({ x: 39, y: 29 })).toEqual({ x: 39, y: 29 });
  });

  test('allows a trial-island tile so a resident can take the ferry route', () => {
    expect(resolveObserverDestination({ x: 48, y: 14 })).toEqual({ x: 48, y: 14 });
  });
});
