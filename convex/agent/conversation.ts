import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalMutation, internalQuery } from '../_generated/server';
import { LLMMessage, chatCompletion } from '../util/llm';
import * as memory from './memory';
import { api, internal } from '../_generated/api';
import * as embeddingsCache from './embeddingsCache';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { NUM_MEMORIES_TO_SEARCH } from '../constants';
import { buildWorldPrompt } from '../../data/worlds/lighthouse-town/manifest';
import { getWorldLocale } from '../util/worldLocale';
import {
  conversationPromptRules,
  deriveTopicSelectionInput,
  filterLegacyMemories,
  isTopicDetail,
  observerSeaCorrectionInstruction,
  selectConversationTopic,
} from './conversationPolicy';

const selfInternal = internal.agent.conversation;
export const CONVERSATION_MAX_TOKENS = 120;

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function shanghaiDayKey(selectedAt: number): string {
  const parts = shanghaiDateFormatter.formatToParts(new Date(selectedAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

type PriorMessage = { author: string; text: string };

const FINAL_QUESTION = /[?？]["'”’」』）)]*\s*$/u;
const CHINESE_QUESTION_ENDING = /(?:吗|么|呢|哪里|哪儿|何处)["'”’」』）)]*\s*$/u;
const EXPLICIT_CHINESE_MARINE = /海洋|海上|大海|海边|海岸|海潮|潮汐|观潮|航标/u;
const CONTEXTUAL_CHINESE_BARE_SEA =
  /(?:(?:有|没有|见过|看过|听过|看到|看见)(?:大)?海(?:吗|么|呢)?|海(?:吗|么|呢|在哪里|在哪儿|在何处))(?:[?？]["'”’」』）)]*\s*|["'”’」』）)]*\s*)$/u;
const CHINESE_TOWER_NAVIGATION =
  /(?:(?:灯塔|这座塔|高塔)[\s\S]{0,12}(?:导航|航行)|(?:导航|航行)[\s\S]{0,12}(?:灯塔|这座塔|高塔))/u;
const EXPLICIT_ENGLISH_MARINE = /\b(?:sea|ocean|tides?|coasts?|seaside)\b/iu;
const ENGLISH_TOWER_NAVIGATION =
  /(?:\b(?:lighthouse|tower)\b[\s\S]{0,80}\b(?:navigation|navigate|navigational|beacon)\b|\b(?:navigation|navigate|navigational|beacon)\b[\s\S]{0,80}\b(?:lighthouse|tower)\b)/iu;

export function observerAskedAboutSea(
  otherPlayer: { id: string; human?: string },
  messages: readonly PriorMessage[],
): boolean {
  if (!otherPlayer.human || messages.length === 0) return false;
  const latest = messages[messages.length - 1];
  const contextualBareSea = CONTEXTUAL_CHINESE_BARE_SEA.test(latest.text);
  return (
    latest.author === otherPlayer.id &&
    (FINAL_QUESTION.test(latest.text) || CHINESE_QUESTION_ENDING.test(latest.text)) &&
    (EXPLICIT_CHINESE_MARINE.test(latest.text) ||
      contextualBareSea ||
      CHINESE_TOWER_NAVIGATION.test(latest.text) ||
      EXPLICIT_ENGLISH_MARINE.test(latest.text) ||
      ENGLISH_TOWER_NAVIGATION.test(latest.text))
  );
}

export const getOrCreateConversationTopic = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('conversationTopics')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('conversationId', args.conversationId)
          .eq('playerId', args.playerId),
      )
      .unique();
    if (existing) return existing;

    const dayKey = shanghaiDayKey(args.now);
    const residentTopics = await ctx.db
      .query('conversationTopics')
      .withIndex('residentDay', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', args.playerId).eq('dayKey', dayKey),
      )
      .order('asc')
      .collect();
    const recentTopics = await ctx.db
      .query('conversationTopics')
      .withIndex('residentTime', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .order('desc')
      .take(3);
    const { counts, recent } = deriveTopicSelectionInput(residentTopics, recentTopics);
    const selected = selectConversationTopic(
      `${dayKey}:${args.worldId}:${args.playerId}:${args.conversationId}`,
      recent,
      counts,
    );

    const sharedTopics = await ctx.db
      .query('conversationTopics')
      .withIndex('conversation', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    const shared = sharedTopics.reduce<(typeof sharedTopics)[number] | undefined>(
      (first, topic) => (!first || topic.selectedAt < first.selectedAt ? topic : first),
      undefined,
    );
    const topic = shared
      ? { category: shared.category, detail: shared.detail }
      : { category: selected.category, detail: selected.detail };
    const record = {
      worldId: args.worldId,
      playerId: args.playerId,
      conversationId: args.conversationId,
      ...topic,
      dayKey,
      selectedAt: args.now,
    };
    await ctx.db.insert('conversationTopics', record);
    return record;
  },
});

export const getConversationPolicyContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    otherPlayerId: playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const topic = await ctx.db
      .query('conversationTopics')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('conversationId', args.conversationId)
          .eq('playerId', args.playerId),
      )
      .unique();
    const world = await ctx.db.get(args.worldId);
    const otherPlayer = world?.players.find((candidate) => candidate.id === args.otherPlayerId) ?? {
      id: args.otherPlayerId,
    };
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();

    const recordedDetail = topic?.detail;
    return {
      topic: isTopicDetail(recordedDetail) ? recordedDetail : 'work',
      observerAskedAboutSea: observerAskedAboutSea(otherPlayer, messages),
    };
  },
});

export async function startConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, agent, otherAgent, lastConversation } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const locale = getWorldLocale();
  const topic = await ctx.runMutation(selfInternal.getOrCreateConversationTopic, {
    worldId,
    playerId,
    conversationId,
    now: Date.now(),
  });
  const embedding = await embeddingsCache.fetch(
    ctx,
    `${player.name} is talking to ${otherPlayer.name}`,
  );

  const searchedMemories = await memory.searchMemories(
    ctx,
    player.id as GameId<'players'>,
    embedding,
    Number(process.env.NUM_MEMORIES_TO_SEARCH) || NUM_MEMORIES_TO_SEARCH,
  );
  const memories = filterLegacyMemories(searchedMemories);

  const memoryWithOtherPlayer = memories.find(
    (m) => m.data.type === 'conversation' && m.data.playerIds.includes(otherPlayerId),
  );
  const prompt = [
    buildWorldPrompt(locale),
    `You are ${player.name}, and you just started a conversation with ${otherPlayer.name}.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...conversationPromptRules(topic, locale));
  prompt.push(...previousConversationPrompt(otherPlayer, lastConversation));
  prompt.push(...relatedMemoriesPrompt(memories));
  if (memoryWithOtherPlayer) {
    prompt.push(
      `Be sure to include some detail or question about a previous conversation in your greeting.`,
    );
  }
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  prompt.push(lastPrompt);

  const { content } = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: CONVERSATION_MAX_TOKENS,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, lastPrompt);
}

function trimContentPrefx(content: string, prompt: string) {
  if (content.startsWith(prompt)) {
    return content.slice(prompt.length).trim();
  }
  return content;
}

export async function continueConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const locale = getWorldLocale();
  const now = Date.now();
  const topic = await ctx.runMutation(selfInternal.getOrCreateConversationTopic, {
    worldId,
    playerId,
    conversationId,
    now,
  });
  const started = new Date(conversation.created);
  const embedding = await embeddingsCache.fetch(
    ctx,
    `What do you think about ${otherPlayer.name}?`,
  );
  const searchedMemories = await memory.searchMemories(
    ctx,
    player.id as GameId<'players'>,
    embedding,
    3,
  );
  const memories = filterLegacyMemories(searchedMemories);
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  const prompt = [
    buildWorldPrompt(locale),
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `The conversation started at ${started.toLocaleString()}. It's now ${now.toLocaleString()}.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...conversationPromptRules(topic, locale));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `DO NOT greet them again. Do NOT use the word "Hey" too often.`,
  );
  if (observerAskedAboutSea(otherPlayer, prevMessages)) {
    prompt.push(observerSeaCorrectionInstruction(locale));
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...formatPreviousMessages(prevMessages, player, otherPlayer),
  ];
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: CONVERSATION_MAX_TOKENS,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, lastPrompt);
}

export async function leaveConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const locale = getWorldLocale();
  const topic = await ctx.runMutation(selfInternal.getOrCreateConversationTopic, {
    worldId,
    playerId,
    conversationId,
    now: Date.now(),
  });
  const embedding = await embeddingsCache.fetch(
    ctx,
    `What should ${player.name} remember while leaving ${otherPlayer.name}?`,
  );
  const searchedMemories = await memory.searchMemories(
    ctx,
    player.id as GameId<'players'>,
    embedding,
    3,
  );
  const memories = filterLegacyMemories(searchedMemories);
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  const prompt = [
    buildWorldPrompt(locale),
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `You've decided to leave the question and would like to politely tell them you're leaving the conversation.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...conversationPromptRules(topic, locale));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `How would you like to tell them that you're leaving?`,
  );
  if (observerAskedAboutSea(otherPlayer, prevMessages)) {
    prompt.push(observerSeaCorrectionInstruction(locale));
  }
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...formatPreviousMessages(prevMessages, player, otherPlayer),
  ];
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: CONVERSATION_MAX_TOKENS,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, lastPrompt);
}

function agentPrompts(
  otherPlayer: { name: string },
  agent: { identity: string; plan: string } | null,
  otherAgent: { identity: string; plan: string } | null,
): string[] {
  const prompt = [];
  if (agent) {
    prompt.push(`About you: ${agent.identity}`);
    prompt.push(`Your goals for the conversation: ${agent.plan}`);
  }
  if (otherAgent) {
    prompt.push(`About ${otherPlayer.name}: ${otherAgent.identity}`);
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: { name: string },
  conversation: { created: number } | null,
): string[] {
  const prompt = [];
  if (conversation) {
    const prev = new Date(conversation.created);
    const now = new Date();
    prompt.push(
      `Last time you chatted with ${
        otherPlayer.name
      } it was ${prev.toLocaleString()}. It's now ${now.toLocaleString()}.`,
    );
  }
  return prompt;
}

function relatedMemoriesPrompt(memories: memory.Memory[]): string[] {
  const prompt = [];
  if (memories.length > 0) {
    prompt.push(`Here are some related memories in decreasing relevance order:`);
    for (const memory of memories) {
      prompt.push(' - ' + memory.description);
    }
  }
  return prompt;
}

function formatPreviousMessages(
  prevMessages: readonly PriorMessage[],
  player: { id: string; name: string },
  otherPlayer: { id: string; name: string },
) {
  const llmMessages: LLMMessage[] = [];
  for (const message of prevMessages) {
    const author = message.author === player.id ? player : otherPlayer;
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  return llmMessages;
}

export const queryPromptData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    otherPlayerId: playerId,
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
    const otherPlayer = world.players.find((p) => p.id === args.otherPlayerId);
    if (!otherPlayer) {
      throw new Error(`Player ${args.otherPlayerId} not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${args.otherPlayerId} not found`);
    }
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    if (!agent) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
    if (!agentDescription) {
      throw new Error(`Agent description for ${agent.id} not found`);
    }
    const otherAgent = world.agents.find((a) => a.playerId === args.otherPlayerId);
    let otherAgentDescription;
    if (otherAgent) {
      otherAgentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', otherAgent.id))
        .first();
      if (!otherAgentDescription) {
        throw new Error(`Agent description for ${otherAgent.id} not found`);
      }
    }
    const lastTogether = await ctx.db
      .query('participatedTogether')
      .withIndex('edge', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('player2', args.otherPlayerId),
      )
      // Order by conversation end time descending.
      .order('desc')
      .first();

    let lastConversation = null;
    if (lastTogether) {
      lastConversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('id', lastTogether.conversationId),
        )
        .first();
      if (!lastConversation) {
        throw new Error(`Conversation ${lastTogether.conversationId} not found`);
      }
    }
    const describedOtherAgent = (() => {
      if (!otherAgent) return undefined;
      if (!otherAgentDescription) {
        throw new Error(`Agent description for ${otherAgent.playerId} not found`);
      }
      return {
        identity: otherAgentDescription.identity,
        plan: otherAgentDescription.plan,
        ...otherAgent,
      };
    })();
    return {
      player: { name: playerDescription.name, ...player },
      otherPlayer: { name: otherPlayerDescription.name, ...otherPlayer },
      conversation,
      agent: { identity: agentDescription.identity, plan: agentDescription.plan, ...agent },
      otherAgent: describedOtherAgent,
      lastConversation,
    };
  },
});

function stopWords(otherPlayer: string, player: string) {
  // These are the words we ask the LLM to stop on. OpenAI only supports 4.
  const variants = [`${otherPlayer} to ${player}`];
  return variants.flatMap((stop) => [stop + ':', stop.toLowerCase() + ':']);
}
