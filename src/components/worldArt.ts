export type WorldArt = {
  url: string;
  backgroundAlpha: number;
  objectAlpha: number;
};

export function worldArtForMap(tileSetUrl: string): WorldArt | undefined {
  if (!tileSetUrl.includes('/worlds/lighthouse-town/')) return undefined;
  return {
    url: '/ai-town/assets/worlds/lighthouse-town/playable-map-v1.webp',
    backgroundAlpha: 1,
    objectAlpha: 0.82,
  };
}
