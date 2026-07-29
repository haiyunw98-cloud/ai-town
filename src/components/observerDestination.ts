import { mapheight, mapwidth } from '../../data/worlds/lighthouse-town/map';

export function resolveObserverDestination(destination: { x: number; y: number }) {
  if (
    !Number.isInteger(destination.x)
    || !Number.isInteger(destination.y)
    || destination.x < 0
    || destination.y < 0
    || destination.x >= mapwidth
    || destination.y >= mapheight
  ) {
    return undefined;
  }
  return destination;
}
