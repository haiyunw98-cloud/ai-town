import { lighthouseCharacters, localizedDescriptions } from './characters';
import { buildWorldPrompt, lighthouseTown } from './manifest';
import { readFileSync } from 'node:fs';

describe('Lighthouse Town content', () => {
  test('defines the approved world identity in both languages', () => {
    expect(lighthouseTown.id).toBe('lighthouse-town');
    expect(lighthouseTown.name['zh-CN']).toBe('灯塔镇');
    expect(lighthouseTown.name.en).toBe('Lighthouse Town');
    expect(lighthouseTown.landmarks).toContain('lighthouse');
  });

  test('defines five unique bilingual residents', () => {
    expect(lighthouseCharacters).toHaveLength(5);
    expect(new Set(lighthouseCharacters.map((character) => character.id)).size).toBe(5);
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

  test('maps residents to the existing Convex description shape', () => {
    expect(localizedDescriptions('zh-CN')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '林澜', character: 'f1' }),
        expect.objectContaining({ name: '苏萤', character: 'f7' }),
      ]),
    );
    expect(localizedDescriptions('en')[0].name).toBe('Lin Lan');
  });

  test('builds an explicit language and setting prompt', () => {
    expect(buildWorldPrompt('zh-CN')).toContain('只使用自然的简体中文');
    expect(buildWorldPrompt('zh-CN')).toContain('你生活在灯塔镇');
    expect(buildWorldPrompt('en')).toContain('Respond in natural English');
    expect(buildWorldPrompt('en')).toContain('You live in Lighthouse Town');
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
    expect(conversation).toContain('buildWorldPrompt(getWorldLocale())');
    expect(memory).toContain('buildWorldPrompt(getWorldLocale())');
  });
});
