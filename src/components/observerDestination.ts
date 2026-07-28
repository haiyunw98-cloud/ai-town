import { mapheight, TOWN_WIDTH } from '../../data/worlds/lighthouse-town/map';

export function resolveMainTownObserverDestination(destination: { x: number; y: number }) {
  if (
    !Number.isInteger(destination.x)
    || !Number.isInteger(destination.y)
    || destination.x < 0
    || destination.y < 0
    || destination.x >= TOWN_WIDTH
    || destination.y >= mapheight
  ) {
    return undefined;
  }
  return destination;
}
