import {
  eventCheckpoints,
  mapheight,
  mapwidth,
  townLandmarkById,
} from '../data/worlds/lighthouse-town/map';
import {
  institutions,
  residentEconomyProfiles,
} from '../data/worlds/lighthouse-town/economy';

export type ObserverCommandId = 'work' | 'rest' | 'eat' | 'shop' | 'plaza' | 'custom';

export type ResolvedObserverCommand = {
  destination: { x: number; y: number };
  description: string;
  emoji: string;
  durationMs: number;
};

export function resolveObserverCommand(
  command: ObserverCommandId,
  residentName: string,
  customDestination?: { x: number; y: number },
): ResolvedObserverCommand {
  if (command === 'custom') {
    if (!customDestination) throw new Error('A custom observer command requires a destination.');
    const { x, y } = customDestination;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error('Custom observer destination must use integer coordinates.');
    }
    if (x < 0 || y < 0 || x >= mapwidth || y >= mapheight) {
      throw new Error('Custom observer destination is outside map bounds.');
    }
    return {
      destination: { x, y },
      description: '按观察者安排前往地图指定位置',
      emoji: '🎯',
      durationMs: 30 * 60_000,
    };
  }

  if (command === 'work') {
    const profile = residentEconomyProfiles.find((candidate) => candidate.name === residentName);
    const institution = profile && institutions.find(
      (candidate) => candidate.id === profile.institutionId,
    );
    if (!profile || !institution) {
      throw new Error(`No workplace is configured for resident ${residentName}.`);
    }
    const landmark = townLandmarkById(institution.landmarkId as Parameters<typeof townLandmarkById>[0]);
    return {
      destination: landmark.destination,
      description: `按观察者安排前往${institution.name}工作`,
      emoji: '💼',
      durationMs: 2 * 60 * 60_000,
    };
  }

  const presets = {
    rest: {
      landmarkId: 'tea-house', description: '按观察者安排前往听雨茶庄休息', emoji: '🍵',
      durationMs: 45 * 60_000,
    },
    eat: {
      landmarkId: 'restaurant', description: '按观察者安排前往河鲜食肆吃饭', emoji: '🍜',
      durationMs: 45 * 60_000,
    },
    shop: {
      landmarkId: 'morning-market', description: '按观察者安排前往晨雾集市购物', emoji: '🧺',
      durationMs: 60 * 60_000,
    },
  } as const;
  if (command === 'plaza') {
    return {
      destination: eventCheckpoints.plaza,
      description: '按观察者安排前往灯塔广场活动',
      emoji: '🎯',
      durationMs: 30 * 60_000,
    };
  }
  const preset = presets[command];
  const landmark = townLandmarkById(preset.landmarkId);
  return {
    destination: landmark.destination,
    description: preset.description,
    emoji: preset.emoji,
    durationMs: preset.durationMs,
  };
}
