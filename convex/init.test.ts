import { localizedDescriptions } from '../data/worlds/lighthouse-town/characters';
import init, { reconcileConfiguredResidentDescriptions } from './init';

type StoredRow = Record<string, any> & { _id: string };

class MemoryDb {
  private nextId = 0;
  readonly rows = new Map<string, StoredRow[]>();
  readonly patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  readonly boundedReads: Array<{ table: string; index: string; count: number }> = [];

  seed(table: string, row: Record<string, unknown>) {
    const stored = { _id: `${table}:${this.nextId++}`, ...row };
    this.table(table).push(stored);
    return stored;
  }

  table(table: string) {
    const rows = this.rows.get(table) ?? [];
    this.rows.set(table, rows);
    return rows;
  }

  get(id: string) {
    return Promise.resolve([...this.rows.values()].flat().find((row) => row._id === id) ?? null);
  }

  query(table: string) {
    const filters: Array<[string, unknown]> = [];
    let index = 'unindexed';
    const query = {
      filter: () => query,
      withIndex: (
        indexName: string,
        apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        index = indexName;
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.push([field, value]);
            return builder;
          },
        };
        apply(builder);
        return query;
      },
      take: (count: number) => {
        this.boundedReads.push({ table, index, count });
        return Promise.resolve(this.matching(table, filters).slice(0, count));
      },
      unique: () => {
        const matches = this.matching(table, filters);
        if (matches.length > 1) throw new Error(`Expected unique ${table} row`);
        return Promise.resolve(matches[0] ?? null);
      },
    };
    return query;
  }

  patch(id: string, value: Record<string, unknown>) {
    const row = [...this.rows.values()].flat().find((candidate) => candidate._id === id);
    if (!row) throw new Error(`Missing ${id}`);
    this.patches.push({ id, value });
    Object.assign(row, value);
    return Promise.resolve();
  }

  private matching(table: string, filters: Array<[string, unknown]>) {
    return this.table(table).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );
  }
}

const descriptions = localizedDescriptions('zh-CN');
const linLan = descriptions[0];

function player(id: string, human?: string) {
  return {
    id,
    ...(human ? { human } : {}),
    lastInput: 1,
    position: { x: 1, y: 1 },
    facing: { dx: 1, dy: 0 },
    speed: 0,
  };
}

function fixture(
  options: {
    human?: boolean;
    character?: string;
    agents?: Array<{ id: string; playerId: string }>;
    agentDescriptions?: Array<Record<string, unknown>>;
  } = {},
) {
  const db = new MemoryDb();
  const world = db.seed('worlds', {
    nextId: 20,
    players: [player('p:7', options.human ? 'human-token' : undefined), player('p:99')],
    agents: options.agents ?? [{ id: 'a:12', playerId: 'p:7' }],
    conversations: [],
  });
  const engine = db.seed('engines', { generationNumber: 4, running: false });
  db.seed('worldStatus', {
    worldId: world._id,
    engineId: engine._id,
    isDefault: true,
    lastViewed: 1,
    status: 'stoppedByDeveloper',
  });
  db.seed('playerDescriptions', {
    worldId: world._id,
    playerId: 'p:7',
    name: linLan.name,
    character: options.character ?? linLan.character,
    description: '她发现灯塔每隔十三夜会闪烁，浓雾令草木焦躁。',
  });
  db.seed('playerDescriptions', {
    worldId: world._id,
    playerId: 'p:99',
    name: '游客甲',
    character: 'visitor',
    description: 'unknown resident',
  });
  for (const row of options.agentDescriptions ?? [
    {
      worldId: world._id,
      agentId: 'a:12',
      identity: '守着十三夜灯塔秘密的守望人。',
      plan: '调查浓雾和草木异动。',
    },
  ]) {
    db.seed('agentDescriptions', row);
  }
  db.seed('messages', {
    worldId: world._id,
    conversationId: 'c:old',
    messageUuid: 'old-message',
    author: 'p:7',
    text: '灯塔每隔十三夜会闪烁。',
  });
  db.seed('lifeEvents', {
    worldId: world._id,
    residentId: 'p:7',
    kind: 'work',
    text: '完成了高塔窗框维护。',
    createdAt: 1,
  });
  return { db, world };
}

const initHandler = (
  init as unknown as {
    _handler: (ctx: unknown, args: { numAgents?: number }) => Promise<unknown>;
  }
)._handler;

describe('persisted resident description migration', () => {
  test('reconciles a stale resident and matching agent before paused init returns', async () => {
    const { db, world } = fixture();
    const messagesBefore = structuredClone(db.table('messages'));
    const lifeBefore = structuredClone(db.table('lifeEvents'));

    await initHandler({ db }, {});

    expect(db.table('playerDescriptions')[0]).toMatchObject({
      playerId: 'p:7',
      name: linLan.name,
      character: linLan.character,
      description: linLan.identity,
    });
    expect(db.table('agentDescriptions')[0]).toMatchObject({
      agentId: 'a:12',
      identity: linLan.identity,
      plan: linLan.plan,
    });
    expect(db.table('worlds')[0]._id).toBe(world._id);
    expect(db.table('playerDescriptions')[1]).toMatchObject({
      playerId: 'p:99',
      name: '游客甲',
      character: 'visitor',
      description: 'unknown resident',
    });
    expect(db.table('messages')).toEqual(messagesBefore);
    expect(db.table('lifeEvents')).toEqual(lifeBefore);
    expect(db.patches).toHaveLength(2);
    expect(db.boundedReads).toEqual(
      expect.arrayContaining([
        { table: 'playerDescriptions', index: 'worldId', count: 2 },
        { table: 'agentDescriptions', index: 'worldId', count: 2 },
      ]),
    );
  });

  test('is idempotent after the first reconciliation', async () => {
    const { db, world } = fixture();

    await reconcileConfiguredResidentDescriptions(
      { db } as never,
      world._id as never,
      descriptions,
    );
    const writesAfterFirstRun = db.patches.length;
    await reconcileConfiguredResidentDescriptions(
      { db } as never,
      world._id as never,
      descriptions,
    );

    expect(writesAfterFirstRun).toBe(2);
    expect(db.patches).toHaveLength(writesAfterFirstRun);
  });

  test('uses a stable character to migrate an old locale display name', async () => {
    const { db, world } = fixture();
    Object.assign(db.table('playerDescriptions')[0], {
      name: 'Lin Lan',
      description: 'Old English profile with a legacy mystery seed.',
    });

    await reconcileConfiguredResidentDescriptions(
      { db } as never,
      world._id as never,
      descriptions,
    );

    expect(db.table('playerDescriptions')[0]).toMatchObject({
      playerId: 'p:7',
      name: linLan.name,
      character: linLan.character,
      description: linLan.identity,
    });
    expect(db.table('agentDescriptions')[0]).toMatchObject({
      agentId: 'a:12',
      identity: linLan.identity,
      plan: linLan.plan,
    });
    expect(db.patches).toHaveLength(2);
  });

  test('fails before any patch when current name and stable character select different residents', async () => {
    const { db, world } = fixture();
    Object.assign(db.table('playerDescriptions')[0], {
      name: descriptions[1].name,
      character: descriptions[0].character,
    });

    await expect(
      reconcileConfiguredResidentDescriptions({ db } as never, world._id as never, descriptions),
    ).rejects.toThrow(/name\/character.*conflict/iu);

    expect(db.patches).toHaveLength(0);
    expect(db.table('playerDescriptions')[0]).toMatchObject({
      name: descriptions[1].name,
      character: descriptions[0].character,
      description: expect.stringContaining('十三夜'),
    });
  });

  test.each([
    {
      name: 'a configured name belongs to a human player',
      setup: () => fixture({ human: true }),
      error: /human player/u,
    },
    {
      name: 'the configured character belongs to another profile',
      setup: () => fixture({ character: descriptions[1].character }),
      error: /character.*conflict/iu,
    },
    {
      name: 'the runtime player has no agent',
      setup: () => fixture({ agents: [] }),
      error: /agent mapping/iu,
    },
    {
      name: 'the runtime player has duplicate agents',
      setup: () =>
        fixture({
          agents: [
            { id: 'a:12', playerId: 'p:7' },
            { id: 'a:13', playerId: 'p:7' },
          ],
        }),
      error: /agent mapping/iu,
    },
    {
      name: 'the agent description is missing',
      setup: () => fixture({ agentDescriptions: [] }),
      error: /agent description mapping/iu,
    },
    {
      name: 'the agent description is duplicated',
      setup: () => {
        const result = fixture();
        result.db.seed('agentDescriptions', {
          worldId: result.world._id,
          agentId: 'a:12',
          identity: 'duplicate',
          plan: 'duplicate',
        });
        return result;
      },
      error: /agent description mapping/iu,
    },
    {
      name: 'the agent identity belongs to another configured profile',
      setup: () =>
        fixture({
          agentDescriptions: [
            {
              worldId: 'placeholder',
              agentId: 'a:12',
              identity: descriptions[1].identity,
              plan: descriptions[1].plan,
            },
          ],
        }),
      fixWorldId: true,
      error: /identity.*conflict/iu,
    },
  ])('fails closed before writes when $name', async ({ setup, error, fixWorldId }) => {
    const { db, world } = setup();
    if (fixWorldId) db.table('agentDescriptions')[0].worldId = world._id;

    await expect(
      reconcileConfiguredResidentDescriptions({ db } as never, world._id as never, descriptions),
    ).rejects.toThrow(error);

    expect(db.patches).toHaveLength(0);
    expect(db.table('playerDescriptions')[0].description).toContain('十三夜');
  });

  test('rejects duplicate configured and persisted resident names before writes', async () => {
    const configuredDuplicate = fixture();
    await expect(
      reconcileConfiguredResidentDescriptions(
        { db: configuredDuplicate.db } as never,
        configuredDuplicate.world._id as never,
        [descriptions[0], { ...descriptions[1], name: descriptions[0].name }],
      ),
    ).rejects.toThrow(/duplicate configured resident name/iu);
    expect(configuredDuplicate.db.patches).toHaveLength(0);

    const persistedDuplicate = fixture();
    const worldRow = persistedDuplicate.db.table('worlds')[0];
    worldRow.players.push(player('p:8'));
    worldRow.agents.push({ id: 'a:14', playerId: 'p:8' });
    persistedDuplicate.db.seed('playerDescriptions', {
      worldId: persistedDuplicate.world._id,
      playerId: 'p:8',
      name: linLan.name,
      character: linLan.character,
      description: linLan.identity,
    });
    persistedDuplicate.db.seed('agentDescriptions', {
      worldId: persistedDuplicate.world._id,
      agentId: 'a:14',
      identity: linLan.identity,
      plan: linLan.plan,
    });

    await expect(
      reconcileConfiguredResidentDescriptions(
        { db: persistedDuplicate.db } as never,
        persistedDuplicate.world._id as never,
        descriptions,
      ),
    ).rejects.toThrow(/duplicate persisted resident name/iu);
    expect(persistedDuplicate.db.patches).toHaveLength(0);
  });

  test.each([
    {
      field: 'character',
      configured: [
        descriptions[0],
        { ...descriptions[1], character: descriptions[0].character },
      ],
      error: /duplicate configured resident character/iu,
    },
    {
      field: 'identity',
      configured: [
        descriptions[0],
        { ...descriptions[1], identity: descriptions[0].identity },
      ],
      error: /duplicate configured resident identity/iu,
    },
  ])('rejects duplicate configured $field before any patch', async ({ configured, error }) => {
    const duplicate = fixture();

    await expect(
      reconcileConfiguredResidentDescriptions(
        { db: duplicate.db } as never,
        duplicate.world._id as never,
        configured,
      ),
    ).rejects.toThrow(error);

    expect(duplicate.db.patches).toHaveLength(0);
    expect(duplicate.db.table('playerDescriptions')[0].description).toContain('十三夜');
  });
});
