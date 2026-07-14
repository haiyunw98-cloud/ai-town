import { lighthouseSpritesheets } from './worlds/lighthouse-town/spritesheets';
import { localizedDescriptions } from './worlds/lighthouse-town/characters';

// Chinese remains the compatibility default for callers that do not run in Convex.
// Server-side agent creation selects WORLD_LOCALE explicitly.
export const Descriptions = localizedDescriptions('zh-CN');

export const characters = [
  {
    name: 'f1',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f1,
    speed: 0.1,
  },
  {
    name: 'f2',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f2,
    speed: 0.1,
  },
  {
    name: 'f3',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f3,
    speed: 0.1,
  },
  {
    name: 'f4',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f4,
    speed: 0.1,
  },
  {
    name: 'f5',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f5,
    speed: 0.1,
  },
  {
    name: 'f6',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f6,
    speed: 0.1,
  },
  {
    name: 'f7',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f7,
    speed: 0.1,
  },
  {
    name: 'f8',
    textureUrl: '/ai-town/assets/worlds/lighthouse-town/residents.svg',
    spritesheetData: lighthouseSpritesheets.f8,
    speed: 0.1,
  },
];

// Characters move at 0.75 tiles per second.
export const movementSpeed = 0.75;
