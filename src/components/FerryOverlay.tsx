import { Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { eventCheckpoints } from '../../data/worlds/lighthouse-town/map';

const labelStyle = new PIXI.TextStyle({
  fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  fill: 0xffedbd,
  stroke: 0x092a2f,
  strokeThickness: 3,
});

// A permanent, large ferry at the old dock makes the connection to Trial
// Island legible even when no resident happens to be crossing at this moment.
export default function FerryOverlay({ tileDim }: { tileDim: number }) {
  return (
    <Container
      x={(eventCheckpoints.dock.x + 2.65) * tileDim}
      y={(eventCheckpoints.dock.y + 0.35) * tileDim}
      aria-label="内河摆渡船停靠旧水码头"
    >
      <Graphics
        draw={(graphics) => {
          graphics.clear();
          graphics.beginFill(0x402015, 0.98);
          graphics.drawPolygon([-48, 8, 42, 8, 29, 25, -35, 25]);
          graphics.endFill();
          graphics.beginFill(0x9a5a2d, 1);
          graphics.drawPolygon([-36, 5, 31, 5, 23, 17, -28, 17]);
          graphics.endFill();
          graphics.beginFill(0xd5aa5a, 0.98);
          graphics.drawRoundedRect(-25, -10, 48, 17, 5);
          graphics.endFill();
          graphics.lineStyle(2, 0x30170f, 0.9);
          graphics.moveTo(-45, 8);
          graphics.lineTo(41, 8);
          graphics.moveTo(-15, -10);
          graphics.lineTo(-15, -25);
        }}
      />
      <Text text="⛴ 内河摆渡" anchor={{ x: 0.5, y: 1 }} y={-27} style={labelStyle} />
    </Container>
  );
}
