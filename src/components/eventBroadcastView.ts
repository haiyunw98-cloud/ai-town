import { Locale } from '../i18n';

export type BroadcastSnapshot = {
  event: null | {
    id: string;
    name: string;
    status: string;
    phase: string;
    phaseEndsAt: number;
    winnerId?: string;
    prize: string;
  };
  participants: Array<{
    residentId: string;
    displayName: string;
    score: number;
    shells: number;
    active: boolean;
    role: string;
    rank?: number;
    quote?: string;
  }>;
  logs: Array<{
    eventKey: string;
    sequence: number;
    kind: string;
    text: string;
    createdAt: number;
  }>;
};

const phaseLabels: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    announcement: '全镇公告',
    treasureHunt: '八人寻宝冲刺',
    lanternRelay: '双人灯火接力',
    secretTrade: '四人秘密交易',
    lighthouseFinal: '灯塔点灯决赛',
    awards: '百万金贝颁奖礼',
  },
  en: {
    announcement: 'Town Announcement',
    treasureHunt: 'Eight-Person Treasure Hunt',
    lanternRelay: 'Lantern Relay',
    secretTrade: 'Secret Trade',
    lighthouseFinal: 'Lighthouse Final',
    awards: 'Million-Shell Awards',
  },
};

export function buildBroadcastView(snapshot: BroadcastSnapshot, locale: Locale, now = Date.now()) {
  if (!snapshot.event) {
    return {
      mode: 'chronicle' as const,
      title: locale === 'zh-CN' ? '灯塔镇镇志' : 'Town Chronicle',
      phaseLabel: '',
      countdown: '--:--',
      activeCount: 0,
      winnerName: undefined,
    };
  }
  const seconds = Math.max(0, Math.ceil((snapshot.event.phaseEndsAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return {
    mode: 'event' as const,
    title: snapshot.event.name,
    phaseLabel: phaseLabels[locale][snapshot.event.phase] ?? snapshot.event.phase,
    countdown: `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`,
    activeCount: snapshot.participants.filter((participant) => participant.active).length,
    winnerName: snapshot.participants.find(
      (participant) => participant.residentId === snapshot.event?.winnerId,
    )?.displayName,
  };
}
