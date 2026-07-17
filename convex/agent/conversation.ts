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
  filterLegacyMemories,
  selectConversationTopic,
  TopicCategory,
  TopicDetail,
} from './conversationPolicy';

const selfInternal = internal.agent.conversation;

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

const TOPIC_LABELS: Record<TopicDetail, string> = {
  work: '工作',
  order: '订单',
  income: '收入',
  shopping: '采购',
  meal: '饮食',
  clothing: '衣物',
  home: '家务',
  rest: '休息',
  health: '健康',
  friendship: '友情',
  care: '照护',
  date: '约会',
  misunderstanding: '误会',
  cooperation: '合作',
  'neighbor-help': '邻里互助',
  market: '集市',
  class: '课程',
  festival: '节庆',
  institution: '机构服务',
  'local-news': '地方消息',
  safety: '公共安全',
};

export function conversationPromptRules(topic: { detail: string }): string[] {
  const label = Object.prototype.hasOwnProperty.call(TOPIC_LABELS, topic.detail)
    ? TOPIC_LABELS[topic.detail as TopicDetail]
    : '日常近况';
  return [
    `本轮日常话题：${label}。`,
    '用自然的简体中文交谈，每轮只推进一个意思。',
    '普通回复控制在 20–60 个中文字符；开场 15–45 字；告别 10–35 字。',
    '不要使用括号舞台说明，不要长篇描写动作、环境或内心。',
    '不要发起异变、谜团、调查、灯塔机关或海洋话题。',
  ];
}

type PriorMessage = { author: string; text: string };

const EXPLICIT_SEA_TOPIC =
  /海洋|航标|观潮|潮汐|导航|航行|(?<!上)海|\b(?:sea|ocean|beacon|navigation)\b/iu;
const QUESTION_FORM = /[?？]|(?:吗|呢|么|怎么|为何|为什么|是否|是不是|有没有|哪里|哪儿|什么|谁|几|多少)(?:[。！!]?)$/iu;

export function observerAskedAboutSea(
  otherPlayer: { id: string; human?: string },
  messages: readonly PriorMessage[],
): boolean {
  if (!otherPlayer.human || messages.length === 0) return false;
  const latest = messages[messages.length - 1];
  return (
    latest.author === otherPlayer.id &&
    EXPLICIT_SEA_TOPIC.test(latest.text) &&
    QUESTION_FORM.test(latest.text.trim())
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
    const counts: Record<TopicCategory, number> = {
      livelihood: 0,
      relationship: 0,
      'public-life': 0,
    };
    for (const topic of residentTopics) counts[topic.category] += 1;
    const recent = residentTopics.slice(-3).map((topic) => topic.detail);
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
    buildWorldPrompt(getWorldLocale()),
    `You are ${player.name}, and you just started a conversation with ${otherPlayer.name}.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...conversationPromptRules(topic));
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
    max_tokens: 120,
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
    buildWorldPrompt(getWorldLocale()),
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `The conversation started at ${started.toLocaleString()}. It's now ${now.toLocaleString()}.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...conversationPromptRules(topic));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `DO NOT greet them again. Do NOT use the word "Hey" too often.`,
  );
  if (observerAskedAboutSea(otherPlayer, prevMessages)) {
    prompt.push(
      '观察者问到了海洋设定。先说“镇上没有海，这座塔只是地标。”，再用一句短问句回应。',
    );
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
    max_tokens: 120,
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
    buildWorldPrompt(getWorldLocale()),
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `You've decided to leave the question and would like to politely tell them you're leaving the conversation.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...conversationPromptRules(topic));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `How would you like to tell them that you're leaving?`,
  );
  if (observerAskedAboutSea(otherPlayer, prevMessages)) {
    prompt.push(
      '观察者问到了海洋设定。先说“镇上没有海，这座塔只是地标。”，再用一句短问句回应。',
    );
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
    max_tokens: 120,
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
