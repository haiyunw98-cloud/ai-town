import { inauguralEventMemory } from './history';

describe('Lighthouse Town historical memory', () => {
  test('keeps the inaugural event as one closed memory without old conversations', () => {
    expect(inauguralEventMemory.eventName).toBe('灯塔镇百万金贝寻宝赛');
    expect(inauguralEventMemory.champion).toBe('白露');
    expect(inauguralEventMemory.logs).toHaveLength(1);
    expect(JSON.stringify(inauguralEventMemory)).toMatch(/封存|共同记忆/u);
    expect(JSON.stringify(inauguralEventMemory)).not.toMatch(/加入了交谈|离开了交谈/u);
  });
});
