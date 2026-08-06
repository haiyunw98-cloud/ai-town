import type {
  WerewolfAction,
  WerewolfRecordedAction,
  WerewolfRole,
} from '../../convex/werewolf/types';

export type WerewolfPanelState = {
  sessionId: string;
  status: 'running' | 'paused' | 'completed';
  mode: 'observe' | 'play';
  phase: string;
  round: number;
  seats: Array<{
    playerId: string;
    displayName: string;
    seatNumber: number;
    alive: boolean;
    role?: WerewolfRole;
  }>;
  publicActions: WerewolfAction[];
  viewerId?: string;
  privateRole?: WerewolfRole;
  legalTargets: string[];
  pendingHumanAction?: WerewolfAction['kind'];
  speakingPlayerId?: string;
  runoffIds: string[];
  winner?: 'good' | 'wolves' | 'draw';
  dawnResults?: Array<{ round: number; eliminatedPlayerIds: string[] }>;
  knownWolfIds?: string[];
  seerResults?: Array<{ targetId: string; camp: 'good' | 'wolves' }>;
  witchNoticeTargetId?: string;
  antidoteAvailable?: boolean;
  poisonAvailable?: boolean;
  observerSecrets?: {
    roles: Record<string, WerewolfRole>;
    nightActions: WerewolfRecordedAction[];
    pendingNightTargetId?: string;
    pendingPoisonTargetId?: string;
  };
};

export type WerewolfPanelView = {
  canStart: boolean;
  startLabels: ['作为观察者开局', '我要加入游戏'];
  title: string;
  phaseLabel: string;
  roundLabel: string;
  privateCard?: { roleLabel: string; instructions: string };
  controls:
    | { kind: 'none' }
    | { kind: 'speech'; maxLength: number }
    | { kind: 'target'; targets: string[] }
    | { kind: 'witch'; targets: string[]; canSave: boolean; canPoison: boolean };
  publicTimeline: Array<{ sequence: number; text: string }>;
};

const roleLabels: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  villager: '平民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

const roleInstructions: Record<WerewolfRole, string> = {
  werewolf: '夜晚与狼队选择一名目标，白天隐藏身份并参与讨论。',
  villager: '根据公开发言与票型找出狼人。',
  seer: '每晚查验一人的阵营，谨慎决定何时公开信息。',
  witch: '你有一瓶解药和一瓶毒药，同一夜只能使用一种。',
  hunter: '被夜袭或投票离场时可以带走一人；被毒离场不能发动。',
};

const phaseLabels: Record<string, string> = {
  'night-wolves': '夜晚 · 狼人选择',
  'night-seer': '夜晚 · 预言家查验',
  'night-witch': '夜晚 · 女巫行动',
  dawn: '天亮结算',
  'day-speaking': '白天 · 依次发言',
  'day-voting': '白天 · 秘密投票',
  'runoff-speaking': '平票 · 加赛发言',
  'runoff-voting': '平票 · 重新投票',
  hunter: '猎人行动',
  completed: '本局结束',
};

export function buildWerewolfPanelView(state?: WerewolfPanelState | null): WerewolfPanelView {
  if (!state) {
    return {
      canStart: true,
      startLabels: ['作为观察者开局', '我要加入游戏'],
      title: '灯塔镇九人狼人杀',
      phaseLabel: '尚未开局',
      roundLabel: '3 狼人 · 3 平民 · 预言家 · 女巫 · 猎人',
      controls: { kind: 'none' },
      publicTimeline: [],
    };
  }
  const name = (playerId?: string) =>
    state.seats.find((seat) => seat.playerId === playerId)?.displayName ?? playerId ?? '无人';
  const publicTimeline = state.publicActions.map((action, sequence) => {
    if (action.kind === 'speech') {
      return { sequence, text: `${name(action.actorId)}：${action.text}` };
    }
    if (action.kind === 'day-vote') {
      return {
        sequence,
        text: action.targetId
          ? `${name(action.actorId)}投给了${name(action.targetId)}`
          : `${name(action.actorId)}选择弃票`,
      };
    }
    if (action.kind === 'hunter-shot') {
      return {
        sequence,
        text: action.targetId
          ? `${name(action.actorId)}发动猎人技能，带${name(action.targetId)}去观众席`
          : `${name(action.actorId)}放弃发动猎人技能`,
      };
    }
    return { sequence, text: `${name(action.actorId)}完成了公开行动` };
  });
  let controls: WerewolfPanelView['controls'] = { kind: 'none' };
  if (state.pendingHumanAction === 'speech') {
    controls = { kind: 'speech', maxLength: state.phase === 'runoff-speaking' ? 40 : 80 };
  } else if (state.pendingHumanAction === 'witch-use') {
    controls = {
      kind: 'witch',
      targets: [...state.legalTargets],
      canSave: state.antidoteAvailable === true && !!state.witchNoticeTargetId,
      canPoison: state.poisonAvailable === true,
    };
  } else if (state.pendingHumanAction) {
    controls = { kind: 'target', targets: [...state.legalTargets] };
  }
  return {
    canStart: state.status === 'completed',
    startLabels: ['作为观察者开局', '我要加入游戏'],
    title: '灯塔镇九人狼人杀',
    phaseLabel: phaseLabels[state.phase] ?? state.phase,
    roundLabel: state.status === 'completed'
      ? `${state.winner === 'good' ? '好人阵营' : state.winner === 'wolves' ? '狼人阵营' : '无人'}获胜`
      : `第 ${state.round} 轮 · ${state.status === 'paused' ? '随小镇暂停' : '进行中'}`,
    privateCard: state.privateRole ? {
      roleLabel: roleLabels[state.privateRole],
      instructions: roleInstructions[state.privateRole],
    } : undefined,
    controls,
    publicTimeline,
  };
}
