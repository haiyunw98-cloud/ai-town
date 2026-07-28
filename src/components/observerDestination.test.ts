import { resolveMainTownObserverDestination } from './observerDestination';

describe('resolveMainTownObserverDestination', () => {
  test('accepts an integer tile in the main town', () => {
    expect(resolveMainTownObserverDestination({ x: 39, y: 29 })).toEqual({ x: 39, y: 29 });
  });

  test('rejects a trial-island tile before it is sent to the server', () => {
    expect(resolveMainTownObserverDestination({ x: 48, y: 14 })).toBeUndefined();
  });
});
