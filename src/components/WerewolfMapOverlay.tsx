import { Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { werewolfCheckpoints } from '../../data/worlds/lighthouse-town/map';

type ViewerSeat = {
  playerId: string;
  displayName: string;
  seatNumber: number;
  alive: boolean;
  role?: string;
};

type PublicAction = {
  kind: string;
  actorId: string;
  targetId?: string;
};

export type WerewolfMapSnapshot = {
  status: 'running' | 'paused' | 'completed';
  phase: string;
  round: number;
  seats: ViewerSeat[];
  publicActions: PublicAction[];
  speakingPlayerId?: string;
  viewerId?: string;
  winner?: 'good' | 'wolves' | 'draw';
} | null | undefined;

const labelStyle = new PIXI.TextStyle({
  fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  fill: 0xffefc2,
  stroke: 0x082c31,
  strokeThickness: 3,
  align: 'center',
});

const titleStyle = new PIXI.TextStyle({
  ...labelStyle,
  fontSize: 13,
  fill: 0xffffff,
});

const phaseNames: Record<string, string> = {
  'night-wolves': '夜晚 · 狼人行动',
  'night-seer': '夜晚 · 预言家行动',
  'night-witch': '夜晚 · 女巫行动',
  dawn: '天亮结算',
  'day-speaking': '白天轮流发言',
  'day-voting': '白天秘密投票',
  'runoff-speaking': '平票加赛发言',
  'runoff-voting': '平票重新投票',
  hunter: '猎人选择',
  completed: '本局结束',
};

export default function WerewolfMapOverlay({
  tileDim,
  snapshot,
}: {
  tileDim: number;
  snapshot: WerewolfMapSnapshot;
}) {
  if (!snapshot || snapshot.status === 'completed') return null;
  const seatsById = new Map(snapshot.seats.map((seat) => [seat.playerId, seat]));
  const recentVotes = snapshot.publicActions.filter((action) => action.kind === 'day-vote').slice(-9);
  return (
    <Container aria-label="灯塔镇狼人杀圆桌">
      <Graphics
        draw={(graphics) => {
          graphics.clear();
          const centerX = werewolfCheckpoints.center.x * tileDim;
          const centerY = werewolfCheckpoints.center.y * tileDim;
          graphics.lineStyle(3, 0xf5c76e, 0.95);
          graphics.beginFill(snapshot.phase.startsWith('night') ? 0x14284d : 0x733c2f, 0.72);
          graphics.drawCircle(centerX, centerY, tileDim * 2.25);
          graphics.endFill();
          for (const vote of recentVotes) {
            const actor = seatsById.get(vote.actorId);
            const target = vote.targetId ? seatsById.get(vote.targetId) : undefined;
            if (!actor || !target) continue;
            const from = werewolfCheckpoints.seats[actor.seatNumber - 1];
            const to = werewolfCheckpoints.seats[target.seatNumber - 1];
            graphics.lineStyle(2, 0xf3b65e, 0.65);
            graphics.moveTo(from.x * tileDim, from.y * tileDim);
            graphics.lineTo(to.x * tileDim, to.y * tileDim);
          }
        }}
      />
      <Container x={werewolfCheckpoints.center.x * tileDim} y={(werewolfCheckpoints.center.y - 0.2) * tileDim}>
        <Text
          text={`🐺 狼人杀 · 第 ${snapshot.round} 轮`}
          anchor={{ x: 0.5, y: 1 }}
          style={titleStyle}
        />
        <Text
          text={phaseNames[snapshot.phase] ?? snapshot.phase}
          anchor={{ x: 0.5, y: 0 }}
          y={2}
          style={labelStyle}
        />
      </Container>
      {snapshot.seats.map((seat) => {
        const point = seat.alive
          ? werewolfCheckpoints.seats[seat.seatNumber - 1]
          : werewolfCheckpoints.spectators[(seat.seatNumber - 1) % werewolfCheckpoints.spectators.length];
        const speaking = snapshot.speakingPlayerId === seat.playerId;
        return (
          <Container key={seat.playerId} x={point.x * tileDim} y={point.y * tileDim}>
            <Graphics draw={(graphics) => {
              graphics.clear();
              graphics.lineStyle(speaking ? 4 : 2, speaking ? 0xfff18a : 0xe0a958, 0.95);
              graphics.beginFill(seat.alive ? 0x0b3c43 : 0x31414a, 0.9);
              graphics.drawCircle(0, 0, speaking ? 17 : 14);
              graphics.endFill();
            }} />
            <Text
              text={`${seat.seatNumber}号${snapshot.viewerId === seat.playerId ? ' · 你' : ''}\n${seat.displayName}${seat.alive ? '' : ' · 观赛'}`}
              anchor={{ x: 0.5, y: 0 }}
              y={17}
              style={labelStyle}
            />
          </Container>
        );
      })}
    </Container>
  );
}
