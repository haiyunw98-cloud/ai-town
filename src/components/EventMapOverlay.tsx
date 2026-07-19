import { Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { trialIslandCheckpoints } from '../../data/worlds/lighthouse-town/map';
import {
  buildEventOverlayState,
  type EventMapSnapshot,
} from './eventMapOverlayModel';

const zoneStyle = new PIXI.TextStyle({
  fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 12,
  fontWeight: '700',
  fill: 0xffedbd,
  stroke: 0x092a2f,
  strokeThickness: 3,
  align: 'center',
});

const activityStyle = new PIXI.TextStyle({
  ...zoneStyle,
  fontSize: 11,
  fill: 0xffffff,
  wordWrap: true,
  wordWrapWidth: 150,
});

const zones = [
  ['arrival', '摆渡码头', '⛴'],
  ['resourceZone', '物资协作区', '📦'],
  ['spectatorStand', '观众席', '👏'],
  ['awards', '颁奖广场', '🏆'],
  ['track', '环岛跑道', '🏃'],
  ['bridge', '彩色踏板桥', '▦'],
  ['teamField', '双队赛场', '⚑'],
  ['courtyard', '休息庭院', '茶'],
  ['maze', '花篱迷宫', '◇'],
  ['final', '终点区', '◆'],
] as const;

const propLabels: Record<string, string> = {
  ferry: '摆渡船',
  'signal-flags': '号令旗',
  'color-tiles': '彩色踏板',
  'tea-table': '茶歇桌',
  rope: '拔河绳',
  'finish-line': '终点线',
  podium: '领奖台',
  toolboxes: '工具箱',
  'food-crates': '物资筐',
  'building-parts': '搭建材料',
  'supply-cart': '运输车',
  batons: '接力棒',
  'finish-flags': '冲刺彩旗',
};

export default function EventMapOverlay({
  tileDim,
  snapshot,
}: {
  tileDim: number;
  snapshot: EventMapSnapshot;
}) {
  const {
    stage,
    activeCheckpoint,
    isIslandEvent,
    spectatorCount,
    teamCount,
    winner,
  } = buildEventOverlayState(snapshot);

  return (
    <Container aria-label="试炼岛活动设施">
      {zones.map(([key, name, icon]) => {
        const checkpoint = trialIslandCheckpoints[key];
        const active = isIslandEvent
          && activeCheckpoint?.x === checkpoint.x
          && activeCheckpoint?.y === checkpoint.y;
        let detail = '';
        if (key === 'spectatorStand' && isIslandEvent && spectatorCount > 0) {
          detail = `${spectatorCount} 人安全观赛`;
        } else if (key === 'teamField' && active && teamCount > 0) {
          detail = `${teamCount} 队比赛中`;
        } else if (key === 'awards' && winner) {
          detail = `冠军 ${winner.displayName}`;
        } else if (active && stage) {
          detail = `${stage.label}${stage.props.map((prop) =>
            propLabels[prop] ? ` · ${propLabels[prop]}` : '').join('')}`;
        }
        const width = Math.max(72, (name.length + 2) * 14);
        return (
          <Container
            key={key}
            x={checkpoint.x * tileDim}
            y={checkpoint.y * tileDim}
          >
            <Graphics
              draw={(graphics) => {
                graphics.clear();
                graphics.lineStyle(active ? 3 : 1, active ? 0xffcf57 : 0xe8bd69, active ? 1 : 0.65);
                graphics.beginFill(active ? 0x8b342d : 0x082c31, active ? 0.94 : 0.76);
                graphics.drawRoundedRect(-width / 2, -15, width, detail ? 45 : 28, 8);
                graphics.endFill();
                if (active) {
                  graphics.lineStyle(2, 0xffed9a, 0.9);
                  graphics.drawCircle(0, 0, 22);
                }
              }}
            />
            <Text
              text={`${active ? '● ' : ''}${icon} ${name}`}
              anchor={{ x: 0.5, y: 0.5 }}
              y={detail ? -2 : 0}
              style={zoneStyle}
            />
            {detail && (
              <Text
                text={detail}
                anchor={{ x: 0.5, y: 0 }}
                y={13}
                style={activityStyle}
              />
            )}
          </Container>
        );
      })}
    </Container>
  );
}
