export type WorldArtSegment = {
  url: string;
  xTiles: number;
  yTiles: number;
  widthTiles: number;
  heightTiles: number;
  backgroundAlpha: number;
};

export type WorldArt = { segments: readonly WorldArtSegment[] };

export function worldArtForMap(tileSetUrl: string): WorldArt | undefined {
  if (!tileSetUrl.includes('/worlds/lighthouse-town/')) return undefined;
  return {
    segments: [
      {
        url: '/ai-town/assets/worlds/lighthouse-town/playable-map-v1.webp',
        xTiles: 0,
        yTiles: 0,
        widthTiles: 40,
        heightTiles: 30,
        backgroundAlpha: 1,
      },
      {
        url: '/ai-town/assets/worlds/lighthouse-town/trial-island-v1.jpg',
        xTiles: 40,
        yTiles: 0,
        widthTiles: 44,
        heightTiles: 30,
        backgroundAlpha: 1,
      },
    ],
  };
}
