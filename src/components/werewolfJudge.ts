import type { WerewolfPhase } from '../../convex/werewolf/types';

export const WEREWOLF_PHASE_ORDER: WerewolfPhase[] = [
  'night-wolves',
  'night-seer',
  'night-witch',
  'dawn',
  'day-speaking',
  'day-voting',
  'runoff-speaking',
  'runoff-voting',
  'hunter',
  'completed',
];

export type WerewolfJudgeCue = {
  line: string;
  tone: 'night' | 'dawn' | 'day' | 'vote' | 'result';
  effect: 'bell' | 'reveal' | 'gavel' | 'none';
};

export const WEREWOLF_OPENING_CUES: Array<WerewolfJudgeCue & { id: string }> = [
  {
    id: 'intro-welcome',
    line: '各位居民，欢迎来到灯塔镇狼人杀圆桌。法官将全程主持，请听从阶段提示。',
    tone: 'day',
    effect: 'bell',
  },
  {
    id: 'intro-seating',
    line: '请九位玩家按座位号入座。上帝观察者可以看到全局，但不会替玩家行动。',
    tone: 'day',
    effect: 'none',
  },
  {
    id: 'intro-roles',
    line: '身份已经分发。狼人、预言家、女巫、猎人和平民请确认自己的身份；现在准备入夜。',
    tone: 'night',
    effect: 'reveal',
  },
];

export function judgeCue(input: {
  phase: WerewolfPhase;
  round: number;
  speakingPlayerName?: string;
  dawnDepartures?: string[];
}): WerewolfJudgeCue {
  switch (input.phase) {
    case 'night-wolves':
      return {
        line: '天黑请闭眼。狼人请睁眼，商量今晚的目标。',
        tone: 'night',
        effect: 'bell',
      };
    case 'night-seer':
      return {
        line: '狼人请闭眼。预言家请睁眼并选择查验对象。',
        tone: 'night',
        effect: 'reveal',
      };
    case 'night-witch':
      return {
        line: '预言家请闭眼。女巫请睁眼并决定是否用药。',
        tone: 'night',
        effect: 'reveal',
      };
    case 'dawn':
      return {
        line: input.dawnDepartures
          ? input.dawnDepartures.length > 0
            ? `天亮了。昨夜${input.dawnDepartures.join('、')}离场，已安全前往观众席。`
            : '天亮了。昨夜平安，无人离场。'
          : '天亮了。现在公布昨夜结果。',
        tone: 'dawn',
        effect: 'bell',
      };
    case 'day-speaking':
      return {
        line: input.speakingPlayerName
          ? `现在请 ${input.speakingPlayerName} 发言。`
          : '现在按座位顺序依次发言。',
        tone: 'day',
        effect: 'none',
      };
    case 'day-voting':
      return { line: '发言结束，现在开始投票。', tone: 'vote', effect: 'gavel' };
    case 'runoff-speaking':
      return { line: '出现平票，请候选人依次补充发言。', tone: 'day', effect: 'gavel' };
    case 'runoff-voting':
      return { line: '补充发言结束，现在重新投票。', tone: 'vote', effect: 'gavel' };
    case 'hunter':
      return { line: '猎人可以选择发动技能，也可以放弃。', tone: 'vote', effect: 'gavel' };
    case 'completed':
      return { line: '本局结束，现在公布身份与结果。', tone: 'result', effect: 'gavel' };
  }
}
