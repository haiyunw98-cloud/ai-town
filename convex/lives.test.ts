import { readFileSync } from 'node:fs';
import { deriveLiveStats } from './lives';
import * as livesModule from './lives';
import { readResidentDossier } from './lives';
import { residentLifeProfiles } from '../data/worlds/lighthouse-town/lives';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import type { GameId } from './aiTown/ids';
import { lighthouseCharacters } from '../data/worlds/lighthouse-town/characters';

const source = readFileSync(new URL('./lives.ts', import.meta.url), 'utf8');

const baseStats = {
  mood: 60,
  energy: 60,
  health: 60,
  finance: 60,
  reputation: 60,
  social: 60,
};

describe('resident live dossier derivation', () => {
  test('conversation and recent messages improve the social snapshot', () => {
    const result = deriveLiveStats(baseStats, {
      isTalking: true,
      isMoving: false,
      recentMessageCount: 4,
    });
    expect(result.situation).toContain('交谈');
    expect(result.stats.social).toBeGreaterThan(baseStats.social);
    expect(result.stats.mood).toBeGreaterThan(baseStats.mood);
  });

  test('uses a current activity as the situation and recognizes commercial work', () => {
    const result = deriveLiveStats(baseStats, {
      isTalking: false,
      isMoving: false,
      activity: '正在茶馆整理今日账目',
      recentMessageCount: 0,
    });
    expect(result.situation).toBe('正在茶馆整理今日账目');
    expect(result.stats.finance).toBeGreaterThan(baseStats.finance);
  });

  test('clamps every derived attribute to the zero-to-one-hundred range', () => {
    const result = deriveLiveStats(
      { mood: 99, energy: 1, health: 100, finance: 100, reputation: 98, social: 100 },
      { isTalking: true, isMoving: true, recentMessageCount: 100 },
    );
    for (const value of Object.values(result.stats)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('resident dossier runtime facts', () => {
  test('exposes the real query handler for bounded runtime identity tests', () => {
    expect(typeof (livesModule as Record<string, unknown>).readResidentDossier).toBe('function');
  });

  test('joins the live economy ledger and relationship evidence instead of presenting derived finance as cash', () => {
    expect(source).toContain("query('residentEconomy')");
    expect(source).toContain("query('economyLedger')");
    expect(source).toContain("query('townRelationships')");
    expect(source).toContain("query('relationshipChanges')");
    expect(source).toContain('economyStatus: worldRuntimeStatus');
    expect(source).toContain("economyStatus: 'initializing'");
    expect(source).toContain('todayIncome');
    expect(source).toContain('todayExpense');
    expect(source).toContain('compensation');
    expect(source).toContain('recentChanges');
  });

  test('returns a paused snapshot without calling frozen facts live', async () => {
    const fixture = residentFixture({ status: 'stoppedByDeveloper', relationshipCount: 8 });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      dossierStatus: 'available',
      worldRuntimeStatus: 'paused',
      snapshotStatus: 'paused',
      relationshipsStatus: 'snapshot',
    }));
    expect(result && 'economy' in result ? result.economy.economyStatus : null).toBe('snapshot');
  });

  test.each([
    ['human resident', { human: true }],
    ['resident without exactly one agent', { agentCount: 0 }],
    ['economy profile mismatch', { economyProfileId: residentLifeProfiles[1].id }],
  ])('fails closed for %s', async (_label, overrides) => {
    const fixture = residentFixture(overrides);
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      dossierStatus: 'unavailable',
      worldRuntimeStatus: 'running',
      snapshotStatus: 'unavailable',
    }));
  });

  test('marks one valid relationship as partial instead of live', async () => {
    const fixture = residentFixture({ relationshipCount: 1 });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      relationshipsStatus: 'partial',
      relationshipCount: 1,
      expectedRelationshipCount: 8,
    }));
  });

  test('marks exactly eight unique adult runtime pairs as live', async () => {
    const fixture = residentFixture({ relationshipCount: 8 });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      relationshipsStatus: 'live',
      relationshipCount: 8,
      expectedRelationshipCount: 8,
    }));
  });

  test('does not let a duplicate target make the relationship network complete', async () => {
    const fixture = residentFixture({ relationshipCount: 8, duplicateTarget: true });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      relationshipsStatus: 'partial',
      relationshipCount: 7,
      expectedRelationshipCount: 8,
    }));
  });

  test('fails closed when selected character and name resolve to different profiles', async () => {
    const fixture = residentFixture({ selectedCharacterNameConflict: true });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      dossierStatus: 'unavailable',
      unavailableReason: 'resident-description-profile',
    }));
  });

  test('fails closed when selected name is unknown despite a valid character', async () => {
    const fixture = residentFixture({ selectedUnknownNameWithValidCharacter: true });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      dossierStatus: 'unavailable',
      unavailableReason: 'resident-description-profile',
    }));
  });

  test('does not count eight target ids when two descriptions resolve to one profile', async () => {
    const fixture = residentFixture({ relationshipCount: 8, duplicateTargetProfile: true });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      relationshipsStatus: 'partial',
      relationshipCount: 7,
    }));
  });

  test('rejects a target whose character and name resolve to different profiles', async () => {
    const fixture = residentFixture({ relationshipCount: 8, targetCharacterNameConflict: true });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      relationshipsStatus: 'partial',
      relationshipCount: 7,
    }));
  });

  test('rejects a target with an unknown name despite a valid character', async () => {
    const fixture = residentFixture({ relationshipCount: 8, targetUnknownNameWithValidCharacter: true });
    const result = await readResidentDossier(fixture.ctx, fixture.args);
    expect(result).toEqual(expect.objectContaining({
      relationshipsStatus: 'partial',
      relationshipCount: 7,
    }));
  });

  test('does not include an underage profile in the adult runtime network', async () => {
    const profile = residentLifeProfiles[8];
    const originalAge = profile.age;
    profile.age = 17;
    try {
      const fixture = residentFixture({ relationshipCount: 8 });
      const result = await readResidentDossier(fixture.ctx, fixture.args);
      expect(result).toEqual(expect.objectContaining({
        relationshipsStatus: 'partial',
        relationshipCount: 7,
      }));
    } finally {
      profile.age = originalAge;
    }
  });
});

type TestRow = Record<string, any> & { _id: string; _creationTime: number };

class QueryMemoryDb {
  private readonly rows = new Map<string, TestRow[]>();

  seed(table: string, row: Record<string, any>) {
    const stored = {
      _id: row._id ?? `${table}:${this.table(table).length + 1}`,
      _creationTime: row._creationTime ?? Date.now(),
      ...row,
    };
    this.table(table).push(stored);
    return stored;
  }

  get(id: string) {
    for (const rows of this.rows.values()) {
      const found = rows.find((row) => row._id === id);
      if (found) return Promise.resolve(found);
    }
    return Promise.resolve(null);
  }

  query(table: string) {
    const filters: Array<[string, unknown]> = [];
    let order: 'asc' | 'desc' = 'asc';
    const matching = () => {
      const rows = this.table(table).filter((row) =>
        filters.every(([field, value]) => row[field] === value),
      );
      return order === 'desc' ? [...rows].reverse() : rows;
    };
    const query = {
      withIndex: (_name: string, apply: (q: any) => unknown) => {
        const builder = { eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return builder;
        } };
        apply(builder);
        return query;
      },
      order: (direction: 'asc' | 'desc') => { order = direction; return query; },
      take: (count: number) => Promise.resolve(matching().slice(0, count)),
      collect: () => Promise.resolve(matching()),
      first: () => Promise.resolve(matching()[0] ?? null),
      unique: () => {
        const rows = matching();
        if (rows.length > 1) throw new Error(`Expected unique ${table}`);
        return Promise.resolve(rows[0] ?? null);
      },
    };
    return query;
  }

  private table(name: string) {
    const rows = this.rows.get(name) ?? [];
    this.rows.set(name, rows);
    return rows;
  }
}

function residentFixture(overrides: {
  status?: 'running' | 'stoppedByDeveloper' | 'inactive';
  human?: boolean;
  agentCount?: number;
  economyProfileId?: string;
  relationshipCount?: number;
  duplicateTarget?: boolean;
  selectedCharacterNameConflict?: boolean;
  selectedUnknownNameWithValidCharacter?: boolean;
  duplicateTargetProfile?: boolean;
  targetCharacterNameConflict?: boolean;
  targetUnknownNameWithValidCharacter?: boolean;
} = {}) {
  const db = new QueryMemoryDb();
  const worldId = 'worlds:dossier' as Id<'worlds'>;
  const profiles = residentLifeProfiles.slice(0, 9);
  const players = profiles.map((profile, index) => ({
    id: `p:${index}`,
    ...(index === 0 && overrides.human ? { human: 'observer' } : {}),
  }));
  const agents = profiles.flatMap((_profile, index) => {
    const count = index === 0 ? overrides.agentCount ?? 1 : 1;
    return Array.from({ length: count }, (_, duplicate) => ({
      id: `a:${index}:${duplicate}`,
      playerId: `p:${index}`,
    }));
  });
  db.seed('worlds', {
    _id: worldId,
    nextId: 20,
    players,
    agents,
    conversations: [],
  });
  db.seed('worldStatus', {
    worldId,
    status: overrides.status ?? 'running',
    isDefault: true,
    engineId: 'engines:test',
    lastViewed: Date.now(),
  });
  profiles.forEach((profile, index) => {
    const duplicateProfile = overrides.duplicateTargetProfile && index === 8;
    const characterConflict = overrides.targetCharacterNameConflict && index === 8;
    const unknownName = (overrides.selectedUnknownNameWithValidCharacter && index === 0)
      || (overrides.targetUnknownNameWithValidCharacter && index === 8);
    db.seed('playerDescriptions', {
      worldId,
      playerId: `p:${index}`,
      name: unknownName ? '未配置居民' : duplicateProfile ? profiles[1].name : profile.name,
      character: unknownName
        ? lighthouseCharacters.find((character) => character.id === profile.id)!.sprite
        : index === 0 && overrides.selectedCharacterNameConflict
        ? lighthouseCharacters.find((character) => character.id === profiles[1].id)!.sprite
        : characterConflict
          ? lighthouseCharacters.find((character) => character.id === profiles[7].id)!.sprite
          : '',
      description: '',
    });
  });
  db.seed('residentEconomy', {
    worldId,
    residentId: 'p:0',
    profileId: overrides.economyProfileId ?? profiles[0].id,
    balance: 120,
    hunger: 80,
    energy: 70,
    todayIncome: 12,
    todayExpense: 4,
    dayKey: '2026-07-19',
    updatedAt: Date.now(),
  });
  const relationshipCount = overrides.relationshipCount ?? 0;
  for (let index = 1; index <= relationshipCount; index += 1) {
    const targetIndex = overrides.duplicateTarget && index === relationshipCount ? 1 : index;
    db.seed('townRelationships', {
      worldId,
      residentA: 'p:0',
      residentB: `p:${targetIndex}`,
      friendship: index,
      trust: index,
      attraction: 0,
      business: 0,
      updatedAt: Date.now(),
    });
  }
  return {
    ctx: { db } as unknown as Pick<QueryCtx, 'db'>,
    args: { worldId, playerId: 'p:0' as GameId<'players'> },
  };
}
