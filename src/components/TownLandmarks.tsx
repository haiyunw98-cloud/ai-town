import { Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import {
  townLandmarks,
  type TownLandmark,
} from '../../data/worlds/lighthouse-town/map';

const labelStyle = new PIXI.TextStyle({
  fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 14,
  fontWeight: '700',
  fill: 0xffedbd,
  stroke: 0x092a2f,
  strokeThickness: 3,
  letterSpacing: 1,
});

export default function TownLandmarks({
  tileDim,
  onSelect,
}: {
  tileDim: number;
  onSelect: (landmark: TownLandmark) => void;
}) {
  return (
    <Container aria-label="灯塔镇地点">
      {townLandmarks.map((landmark) => {
        const width = 30 + landmark.name.length * 15;
        return (
          <Container
            key={landmark.name}
            x={landmark.x * tileDim}
            y={landmark.y * tileDim}
            eventMode="static"
            interactive
            hitArea={new PIXI.Rectangle(-width / 2, -16, width, 32)}
            cursor="pointer"
            accessible
            accessibleType="button"
            accessibleTitle={`查看${landmark.name}机构详情`}
            onpointerdown={(event) => event.stopPropagation()}
            onpointerup={(event) => event.stopPropagation()}
            onpointertap={(event) => {
              event.stopPropagation();
              onSelect(landmark);
            }}
          >
            <Graphics
              draw={(graphics) => {
                graphics.clear();
                graphics.lineStyle(1, 0xe8bd69, 0.72);
                graphics.beginFill(0x082c31, 0.84);
                graphics.drawRoundedRect(-width / 2, -13, width, 26, 8);
                graphics.endFill();
              }}
            />
            <Text
              text={`${landmark.icon} ${landmark.name}`}
              anchor={{ x: 0.5, y: 0.5 }}
              style={labelStyle}
            />
          </Container>
        );
      })}
    </Container>
  );
}
