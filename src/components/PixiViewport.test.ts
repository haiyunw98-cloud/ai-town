import { initialViewportScale } from './viewportMath';

describe('Pixi viewport framing', () => {
  test('covers the available town panel without blank side gutters', () => {
    expect(initialViewportScale(720, 340, 1280, 960)).toBeCloseTo(0.585, 3);
    expect(initialViewportScale(1254, 694, 2304, 1920)).toBeCloseTo(0.566, 3);
  });
});
