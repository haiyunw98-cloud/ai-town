import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalMutation, internalQuery } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import {
  assertLocalOllamaProvider,
  LLMMessage,
  fetchEmbedding,
  localChatCompletionOnce,
} from '../util/llm';
import { asyncMap } from '../util/asyncMap';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { memoryFields } from './schema';
import { buildWorldPrompt, WorldLocale } from '../../data/worlds/lighthouse-town/manifest';
import { getWorldLocale } from '../util/worldLocale';
import {
  containsForbiddenAutonomousMemory,
  filterLegacyMemories,
  segmentConversationGraphemes,
} from './conversationPolicy';

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;
const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

const MEMORY_SUMMARY_FALLBACK: Record<WorldLocale, string> = {
  'zh-CN': '我记得我们聊了些日常近况。',
  en: 'I remember we talked about everyday life.',
};

function stripMemoryStageDirections(value: string): string {
  const opening = new Set(['(', '（', '[', '【']);
  const closing = new Set([')', '）', ']', '】']);
  let depth = 0;
  let result = '';
  for (const character of value) {
    if (opening.has(character)) {
      depth += 1;
    } else if (closing.has(character)) {
      if (depth > 0) depth -= 1;
    } else if (depth === 0) {
      result += character;
    }
  }
  return result;
}

export function sanitizeMemorySummary(raw: string, locale: WorldLocale): string {
  const fallback = MEMORY_SUMMARY_FALLBACK[locale];
  const sanitized = stripMemoryStageDirections(raw).replace(/\s+/gu, ' ').trim();
  if (!sanitized || containsForbiddenAutonomousMemory(raw)) return fallback;
  const shortened = segmentConversationGraphemes(sanitized).slice(0, 80).join('').trim();
  if (!shortened || containsForbiddenAutonomousMemory(shortened)) return fallback;
  return shortened;
}

export function prepareReflectionInput<
  T extends { _creationTime: number; importance: number; description: string },
>(memories: readonly T[], lastReflectionTs?: number) {
  const filtered = filterLegacyMemories(memories);
  return {
    memories: filtered,
    sumOfImportanceScore: filtered
      .filter((memory) => memory._creationTime > (lastReflectionTs ?? 0))
      .reduce((sum, memory) => sum + memory.importance, 0),
    statements: filtered.map((memory, index) => `Statement ${index}: ${memory.description}`),
  };
}

export function reflectionRelatedMemoryIds<T extends { _id: unknown }>(
  memories: readonly T[],
  statementIds: readonly number[],
): Array<T['_id']> {
  return statementIds.flatMap((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= memories.length) return [];
    return [memories[index]._id];
  });
}

export async function runLocalMemoryExternalWork<T>(dependencies: {
  assertLocalProvider: () => unknown;
  work: () => Promise<T>;
}): Promise<T> {
  dependencies.assertLocalProvider();
  return dependencies.work();
}

export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    worldId,
    playerId,
    conversationId,
  });
  const { player, otherPlayer } = data;
  const messages = await ctx.runQuery(selfInternal.loadMessages, { worldId, conversationId });
  if (!messages.length) {
    return;
  }

  const locale = getWorldLocale();
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: buildWorldPrompt(locale),
    },
    {
      role: 'user',
      content:
        locale === 'zh-CN'
          ? '用第一人称简体中文，只总结实际谈到的日常生活、承诺、交易、帮助或分歧。控制在 80 个中文字符以内。不要增加海洋、灯塔谜团、异变、心理诊断或未说出口的感情。'
          : 'In first-person English, summarize only the daily life, promises, transactions, help, or disagreements actually discussed. Keep it within 80 characters. Do not add oceans, lighthouse mysteries, anomalies, psychological diagnoses, or unspoken feelings.',
    },
  ];
  const authors = new Set<GameId<'players'>>();
  for (const message of messages) {
    const author = message.author === player.id ? player : otherPlayer;
    authors.add(author.id as GameId<'players'>);
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: 'Summary:' });
  return runLocalMemoryExternalWork({
    assertLocalProvider: assertLocalOllamaProvider,
    work: async () => {
      let summaryRaw = '';
      try {
        const completion = await localChatCompletionOnce({
          model: 'gemma4:12b',
          messages: llmMessages,
          max_tokens: 160,
        });
        summaryRaw = completion.content;
      } catch {
        console.warn('memory-summary-provider-unavailable');
      }
      const summary = sanitizeMemorySummary(summaryRaw, locale);
      const description = `Conversation with ${otherPlayer.name} at ${new Date(
        data.conversation._creationTime,
      ).toLocaleString()}: ${summary}`;
      const importance = await calculateImportance(description);
      const { embedding } = await fetchEmbedding(description);
      authors.delete(player.id as GameId<'players'>);
      await ctx.runMutation(selfInternal.insertMemory, {
        agentId,
        playerId: player.id,
        description,
        importance,
        lastAccess: messages[messages.length - 1]._creationTime,
        data: {
          type: 'conversation',
          conversationId,
          playerIds: [...authors],
        },
        embedding,
      });
      await reflectOnMemories(ctx, worldId, playerId);
      return description;
    },
  });
}

export const loadConversation = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const conversation = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
      .first();
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const otherParticipator = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();
    if (!otherParticipator) {
      throw new Error(
        `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
      );
    }
    const otherPlayerId = otherParticipator.player2;
    let otherPlayer: SerializedPlayer | Doc<'archivedPlayers'> | null =
      world.players.find((p) => p.id === otherPlayerId) ?? null;
    if (!otherPlayer) {
      otherPlayer = await ctx.db
        .query('archivedPlayers')
        .withIndex('worldId', (q) => q.eq('worldId', world._id).eq('id', otherPlayerId))
        .first();
    }
    if (!otherPlayer) {
      throw new Error(`Conversation ${args.conversationId} other player not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${otherPlayerId} not found`);
    }
    return {
      player: { ...player, name: playerDescription.name },
      conversation,
      otherPlayer: { ...otherPlayer, name: otherPlayerDescription.name },
    };
  },
});

export async function searchMemories(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  searchEmbedding: number[],
  n: number = 3,
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('playerId', playerId),
    limit: n * MEMORY_OVERFETCH,
  });
  const rankedMemories = await ctx.runMutation(selfInternal.rankAndTouchMemories, {
    candidates,
    n,
  });
  return rankedMemories.map(({ memory }) => memory);
}

function makeRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [min, max] as const;
}

function normalize(value: number, range: readonly [number, number]) {
  const [min, max] = range;
  return (value - min) / (max - min);
}

export const rankAndTouchMemories = internalMutation({
  args: {
    candidates: v.array(v.object({ _id: v.id('memoryEmbeddings'), _score: v.number() })),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const relatedMemories = await asyncMap(args.candidates, async ({ _id }) => {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      if (!memory) throw new Error(`Memory for embedding ${_id} not found`);
      return memory;
    });

    // TODO: fetch <count> recent memories and <count> important memories
    // so we don't miss them in case they were a little less relevant.
    const recencyScore = relatedMemories.map((memory) => {
      const hoursSinceAccess = (ts - memory.lastAccess) / 1000 / 60 / 60;
      return 0.99 ** Math.floor(hoursSinceAccess);
    });
    const relevanceRange = makeRange(args.candidates.map((c) => c._score));
    const importanceRange = makeRange(relatedMemories.map((m) => m.importance));
    const recencyRange = makeRange(recencyScore);
    const memoryScores = relatedMemories.map((memory, idx) => ({
      memory,
      overallScore:
        normalize(args.candidates[idx]._score, relevanceRange) +
        normalize(memory.importance, importanceRange) +
        normalize(recencyScore[idx], recencyRange),
    }));
    memoryScores.sort((a, b) => b.overallScore - a.overallScore);
    const accessed = memoryScores.slice(0, args.n);
    await asyncMap(accessed, async ({ memory }) => {
      if (memory.lastAccess < ts - MEMORY_ACCESS_THROTTLE) {
        await ctx.db.patch(memory._id, { lastAccess: ts });
      }
    });
    return accessed;
  },
});

export const loadMessages = internalQuery({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args): Promise<Doc<'messages'>[]> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    return messages;
  },
});

async function calculateImportance(description: string) {
  const { content: importanceRaw } = await localChatCompletionOnce({
    model: 'gemma4:12b',
    messages: [
      {
        role: 'user',
        content: `On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.
      Memory: ${description}
      Answer on a scale of 0 to 9. Respond with number only, e.g. "5"`,
      },
    ],
    temperature: 0.0,
    max_tokens: 1,
  });

  let importance = parseFloat(importanceRaw);
  if (isNaN(importance)) {
    importance = +(importanceRaw.match(/\d+/)?.[0] ?? NaN);
  }
  if (isNaN(importance)) {
    console.warn('memory-importance-unparseable');
    importance = 5;
  }
  return importance;
}

const { embeddingId: _embeddingId, ...memoryFieldsWithoutEmbeddingId } = memoryFields;

export const insertMemory = internalMutation({
  args: {
    agentId,
    embedding: v.array(v.float64()),
    ...memoryFieldsWithoutEmbeddingId,
  },
  handler: async (ctx, { agentId: _, embedding, ...memory }): Promise<void> => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: memory.playerId,
      embedding,
    });
    await ctx.db.insert('memories', {
      ...memory,
      embeddingId,
    });
  },
});

export const insertReflectionMemories = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    reflections: v.array(
      v.object({
        description: v.string(),
        relatedMemoryIds: v.array(v.id('memories')),
        importance: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, { playerId, reflections }) => {
    const lastAccess = Date.now();
    for (const { embedding, relatedMemoryIds, ...rest } of reflections) {
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        playerId,
        embedding,
      });
      await ctx.db.insert('memories', {
        playerId,
        embeddingId,
        lastAccess,
        ...rest,
        data: {
          type: 'reflection',
          relatedMemoryIds,
        },
      });
    }
  },
});

async function reflectOnMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
) {
  assertLocalOllamaProvider();
  const result = await ctx.runQuery(internal.agent.memory.getReflectionMemories, {
    worldId,
    playerId,
    numberOfItems: 100,
  });
  const { name, lastReflectionTs } = result;
  const prepared = prepareReflectionInput(result.memories, lastReflectionTs);
  const memories = prepared.memories;

  // should only reflect if lastest 100 items have importance score of >500
  const { sumOfImportanceScore } = prepared;
  const shouldReflect = sumOfImportanceScore > 500;

  if (!shouldReflect) {
    return false;
  }
  const prompt = [
    buildWorldPrompt(getWorldLocale()),
    '[no prose]',
    '[Output only JSON]',
    `You are ${name}, statements about you:`,
  ];
  prompt.push(...prepared.statements);
  prompt.push('What 3 high-level insights can you infer from the above statements?');
  prompt.push(
    'Return in JSON format, where the key is a list of input statements that contributed to your insights and value is your insight. Make the response parseable by Typescript JSON.parse() function. DO NOT escape characters or include "\n" or white space in response.',
  );
  prompt.push(
    'Example: [{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]',
  );

  const { content: reflection } = await localChatCompletionOnce({
    model: 'gemma4:12b',
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
  });

  try {
    const insights = JSON.parse(reflection) as { insight: string; statementIds: number[] }[];
    const candidateMemories = await asyncMap(insights, async (item) => {
      if (containsForbiddenAutonomousMemory(item.insight)) return null;
      const description = sanitizeMemorySummary(item.insight, getWorldLocale());
      const relatedMemoryIds = reflectionRelatedMemoryIds(memories, item.statementIds);
      const importance = await calculateImportance(description);
      const { embedding } = await fetchEmbedding(description);
      return {
        description,
        embedding,
        importance,
        relatedMemoryIds,
      };
    });
    const memoriesToSave = candidateMemories.filter(
      (memory): memory is NonNullable<typeof memory> => memory !== null,
    );

    if (memoriesToSave.length > 0) {
      await ctx.runMutation(selfInternal.insertReflectionMemories, {
        worldId,
        playerId,
        reflections: memoriesToSave,
      });
    }
  } catch {
    console.warn('reflection-processing-failed');
    return false;
  }
  return true;
}
export const getReflectionMemories = internalQuery({
  args: { worldId: v.id('worlds'), playerId, numberOfItems: v.number() },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', player.id))
      .order('desc')
      .take(args.numberOfItems);

    const lastReflection = await ctx.db
      .query('memories')
      .withIndex('playerId_type', (q) =>
        q.eq('playerId', args.playerId).eq('data.type', 'reflection'),
      )
      .order('desc')
      .first();

    return {
      name: playerDescription.name,
      memories,
      lastReflectionTs: lastReflection?._creationTime,
    };
  },
});

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  playerId: GameId<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}
