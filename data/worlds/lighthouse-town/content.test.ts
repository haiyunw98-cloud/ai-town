import { lighthouseCharacters, localizedDescriptions } from './characters';
import { residentActivities } from './activities';
import { residentLifeProfiles } from './lives';
import { buildWorldPrompt, lighthouseTown } from './manifest';
import { townLandmarks } from './map';
import { readFileSync } from 'node:fs';

const forbiddenGlobalStory = /海潮|潮汐|海风|海浪|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮/u;
const forbiddenAutonomousStory = /海潮|潮汐|海风|海浪|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮|航标|夜航/u;
const forbiddenEnglishAutonomousStory =
  /fog tide|lost route|sea-less route|night navigation|sea navigation|ocean navigation|lighthouse myster(?:y|ies)/iu;

describe('Lighthouse Town content', () => {
  test('defines the approved world identity in both languages', () => {
    expect(lighthouseTown.id).toBe('lighthouse-town');
    expect(lighthouseTown.name['zh-CN']).toBe('灯塔镇');
    expect(lighthouseTown.name.en).toBe('Lighthouse Town');
    expect(lighthouseTown.landmarks).toContain('lighthouse');
  });

  test('defines nine unique bilingual residents', () => {
    expect(lighthouseCharacters).toHaveLength(9);
    expect(new Set(lighthouseCharacters.map((character) => character.id)).size).toBe(9);
    expect(new Set(lighthouseCharacters.map((character) => character.sprite)).size).toBe(9);
    expect(lighthouseCharacters.map((character) => character.name['zh-CN'])).toEqual(
      expect.arrayContaining([
        '林澜',
        '沈砚',
        '唐果',
        '墨七',
        '苏萤',
        '白露',
        '顾潮',
        '阿满',
        '玄微先生',
      ]),
    );
    for (const character of lighthouseCharacters) {
      expect(character.name['zh-CN']).toBeTruthy();
      expect(character.name.en).toBeTruthy();
      expect(character.identity['zh-CN']).toContain('灯塔镇');
      expect(character.identity.en).toContain('Lighthouse Town');
      expect(character.plan['zh-CN']).toBeTruthy();
      expect(character.plan.en).toBeTruthy();
      expect(character.speakingStyle['zh-CN']).toBeTruthy();
      expect(character.speakingStyle.en).toBeTruthy();
      expect(character.relationshipHook['zh-CN']).toBeTruthy();
      expect(character.clue['zh-CN']).toBeTruthy();
    }
  });

  test('keeps the fortune teller grounded and socially connected', () => {
    const fortuneTeller = lighthouseCharacters.find((character) => character.id === 'xuan-wei');
    expect(fortuneTeller?.sprite).toBe('f9');
    expect(fortuneTeller?.identity['zh-CN']).toContain('卜算');
    expect(fortuneTeller?.identity['zh-CN']).toContain('不能代替');
    expect(fortuneTeller?.relationshipHook['zh-CN']).toContain('沈砚');
    expect(fortuneTeller?.plan['zh-CN']).toContain('卦馆');
  });

  test('maps residents to the existing Convex description shape', () => {
    expect(localizedDescriptions('zh-CN')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '林澜', character: 'f1' }),
        expect.objectContaining({ name: '苏萤', character: 'f7' }),
      ]),
    );
    expect(localizedDescriptions('en')[0].name).toBe('Lin Lan');
  });

  test('keeps archived clues out of runtime resident identities', () => {
    const runtimeResidents = localizedDescriptions('zh-CN');

    expect(lighthouseCharacters.every((character) => character.clue['zh-CN'].length > 0)).toBe(true);
    expect(lighthouseCharacters.some((character) => character.clue['zh-CN'].includes('无海航路'))).toBe(true);
    expect(JSON.stringify(runtimeResidents)).not.toContain('无海航路');
    for (const [index, character] of lighthouseCharacters.entries()) {
      expect(runtimeResidents[index].identity).not.toContain(character.clue['zh-CN']);
    }
  });

  test('keeps English clue archives out of English runtime identities', () => {
    const runtimeResidents = localizedDescriptions('en');

    expect(lighthouseCharacters.every((character) => character.clue.en.length > 0)).toBe(true);
    expect(lighthouseCharacters.some((character) => character.clue.en.includes('sea-less route'))).toBe(true);
    expect(JSON.stringify(runtimeResidents)).not.toMatch(forbiddenEnglishAutonomousStory);
    for (const [index, character] of lighthouseCharacters.entries()) {
      expect(runtimeResidents[index].identity).not.toContain(character.clue.en);
    }
  });

  test('grounds all runtime context in ordinary inland Jiangnan life', () => {
    const runtimeContext = JSON.stringify({
      residents: localizedDescriptions('zh-CN'),
      activities: residentActivities,
      lives: residentLifeProfiles,
      landmarks: townLandmarks,
      worldPrompt: buildWorldPrompt('zh-CN'),
    });

    expect(runtimeContext).toContain('江南内陆');
    expect(runtimeContext).toContain('镇上没有海');
    expect(runtimeContext).not.toMatch(forbiddenGlobalStory);
  });

  test('keeps autonomous resident fields free of navigation and mystery prompts', () => {
    const autonomousContext = JSON.stringify({
      residents: localizedDescriptions('zh-CN'),
      activities: Object.values(residentActivities).flatMap((activities) =>
        activities.map((activity) => activity.description),
      ),
      lives: residentLifeProfiles.map((profile) => ({
        currentGoal: profile.currentGoal,
        recentHighlights: profile.recentHighlights,
      })),
    });

    expect(autonomousContext).not.toMatch(forbiddenAutonomousStory);
  });

  test('builds an explicit language and setting prompt', () => {
    expect(buildWorldPrompt('zh-CN')).toContain('只使用自然的简体中文');
    expect(buildWorldPrompt('zh-CN')).toContain('你生活在灯塔镇');
    expect(buildWorldPrompt('en')).toContain('Respond in natural English');
    expect(buildWorldPrompt('en')).toContain('You live in Lighthouse Town');
    expect(buildWorldPrompt('zh-CN')).toContain('这座塔只是地标');
    expect(buildWorldPrompt('en')).toContain('the town has no sea');
    expect(buildWorldPrompt('zh-CN')).toMatch(/镇中心高塔.*不.*航标/u);
    expect(buildWorldPrompt('en')).toMatch(
      /central tower.*not used for navigation or as a beacon/iu,
    );
  });

  test('wires localized residents and world prompts into the simulation', () => {
    const agentInputs = readFileSync(
      new URL('../../../convex/aiTown/agentInputs.ts', import.meta.url),
      'utf8',
    );
    const conversation = readFileSync(
      new URL('../../../convex/agent/conversation.ts', import.meta.url),
      'utf8',
    );
    const memory = readFileSync(new URL('../../../convex/agent/memory.ts', import.meta.url), 'utf8');
    expect(agentInputs).toContain('localizedDescriptions(getWorldLocale())');
    expect(conversation.match(/const locale = getWorldLocale\(\)/gu)).toHaveLength(3);
    expect(conversation.match(/buildWorldPrompt\(locale\)/gu)).toHaveLength(3);
    expect(memory).toContain('buildWorldPrompt(getWorldLocale())');
  });
});
