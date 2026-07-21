/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_conversation from "../agent/conversation.js";
import type * as agent_conversationPolicy from "../agent/conversationPolicy.js";
import type * as agent_embeddingsCache from "../agent/embeddingsCache.js";
import type * as agent_memory from "../agent/memory.js";
import type * as aiTown_agent from "../aiTown/agent.js";
import type * as aiTown_agentDescription from "../aiTown/agentDescription.js";
import type * as aiTown_agentInputs from "../aiTown/agentInputs.js";
import type * as aiTown_agentOperations from "../aiTown/agentOperations.js";
import type * as aiTown_conversation from "../aiTown/conversation.js";
import type * as aiTown_conversationMembership from "../aiTown/conversationMembership.js";
import type * as aiTown_conversationPriority from "../aiTown/conversationPriority.js";
import type * as aiTown_game from "../aiTown/game.js";
import type * as aiTown_ids from "../aiTown/ids.js";
import type * as aiTown_inputHandler from "../aiTown/inputHandler.js";
import type * as aiTown_inputs from "../aiTown/inputs.js";
import type * as aiTown_insertInput from "../aiTown/insertInput.js";
import type * as aiTown_location from "../aiTown/location.js";
import type * as aiTown_main from "../aiTown/main.js";
import type * as aiTown_movement from "../aiTown/movement.js";
import type * as aiTown_player from "../aiTown/player.js";
import type * as aiTown_playerDescription from "../aiTown/playerDescription.js";
import type * as aiTown_world from "../aiTown/world.js";
import type * as aiTown_worldMap from "../aiTown/worldMap.js";
import type * as backgroundLife from "../backgroundLife.js";
import type * as backgroundLifeRules from "../backgroundLifeRules.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as engine_abstractGame from "../engine/abstractGame.js";
import type * as engine_historicalObject from "../engine/historicalObject.js";
import type * as events from "../events.js";
import type * as events_dailyPersistence from "../events/dailyPersistence.js";
import type * as events_dailySchedule from "../events/dailySchedule.js";
import type * as events_dailyStateMachine from "../events/dailyStateMachine.js";
import type * as events_dailyTemplates from "../events/dailyTemplates.js";
import type * as events_dailyTheme from "../events/dailyTheme.js";
import type * as events_localGemmaPolicy from "../events/localGemmaPolicy.js";
import type * as events_model from "../events/model.js";
import type * as events_stateMachine from "../events/stateMachine.js";
import type * as events_types from "../events/types.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as lives from "../lives.js";
import type * as messages from "../messages.js";
import type * as music from "../music.js";
import type * as observerCommands from "../observerCommands.js";
import type * as socialObservations from "../socialObservations.js";
import type * as testing from "../testing.js";
import type * as townEconomy from "../townEconomy.js";
import type * as townEconomyRules from "../townEconomyRules.js";
import type * as townRelations from "../townRelations.js";
import type * as util_FastIntegerCompression from "../util/FastIntegerCompression.js";
import type * as util_assertNever from "../util/assertNever.js";
import type * as util_asyncMap from "../util/asyncMap.js";
import type * as util_compression from "../util/compression.js";
import type * as util_conversationText from "../util/conversationText.js";
import type * as util_conversationTextPolicy from "../util/conversationTextPolicy.js";
import type * as util_embeddingDimension from "../util/embeddingDimension.js";
import type * as util_geometry from "../util/geometry.js";
import type * as util_isSimpleObject from "../util/isSimpleObject.js";
import type * as util_llm from "../util/llm.js";
import type * as util_llmConfig from "../util/llmConfig.js";
import type * as util_minheap from "../util/minheap.js";
import type * as util_object from "../util/object.js";
import type * as util_sleep from "../util/sleep.js";
import type * as util_types from "../util/types.js";
import type * as util_worldLocale from "../util/worldLocale.js";
import type * as util_xxhash from "../util/xxhash.js";
import type * as world from "../world.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/conversation": typeof agent_conversation;
  "agent/conversationPolicy": typeof agent_conversationPolicy;
  "agent/embeddingsCache": typeof agent_embeddingsCache;
  "agent/memory": typeof agent_memory;
  "aiTown/agent": typeof aiTown_agent;
  "aiTown/agentDescription": typeof aiTown_agentDescription;
  "aiTown/agentInputs": typeof aiTown_agentInputs;
  "aiTown/agentOperations": typeof aiTown_agentOperations;
  "aiTown/conversation": typeof aiTown_conversation;
  "aiTown/conversationMembership": typeof aiTown_conversationMembership;
  "aiTown/conversationPriority": typeof aiTown_conversationPriority;
  "aiTown/game": typeof aiTown_game;
  "aiTown/ids": typeof aiTown_ids;
  "aiTown/inputHandler": typeof aiTown_inputHandler;
  "aiTown/inputs": typeof aiTown_inputs;
  "aiTown/insertInput": typeof aiTown_insertInput;
  "aiTown/location": typeof aiTown_location;
  "aiTown/main": typeof aiTown_main;
  "aiTown/movement": typeof aiTown_movement;
  "aiTown/player": typeof aiTown_player;
  "aiTown/playerDescription": typeof aiTown_playerDescription;
  "aiTown/world": typeof aiTown_world;
  "aiTown/worldMap": typeof aiTown_worldMap;
  backgroundLife: typeof backgroundLife;
  backgroundLifeRules: typeof backgroundLifeRules;
  constants: typeof constants;
  crons: typeof crons;
  "engine/abstractGame": typeof engine_abstractGame;
  "engine/historicalObject": typeof engine_historicalObject;
  events: typeof events;
  "events/dailyPersistence": typeof events_dailyPersistence;
  "events/dailySchedule": typeof events_dailySchedule;
  "events/dailyStateMachine": typeof events_dailyStateMachine;
  "events/dailyTemplates": typeof events_dailyTemplates;
  "events/dailyTheme": typeof events_dailyTheme;
  "events/localGemmaPolicy": typeof events_localGemmaPolicy;
  "events/model": typeof events_model;
  "events/stateMachine": typeof events_stateMachine;
  "events/types": typeof events_types;
  http: typeof http;
  init: typeof init;
  lives: typeof lives;
  messages: typeof messages;
  music: typeof music;
  observerCommands: typeof observerCommands;
  socialObservations: typeof socialObservations;
  testing: typeof testing;
  townEconomy: typeof townEconomy;
  townEconomyRules: typeof townEconomyRules;
  townRelations: typeof townRelations;
  "util/FastIntegerCompression": typeof util_FastIntegerCompression;
  "util/assertNever": typeof util_assertNever;
  "util/asyncMap": typeof util_asyncMap;
  "util/compression": typeof util_compression;
  "util/conversationText": typeof util_conversationText;
  "util/conversationTextPolicy": typeof util_conversationTextPolicy;
  "util/embeddingDimension": typeof util_embeddingDimension;
  "util/geometry": typeof util_geometry;
  "util/isSimpleObject": typeof util_isSimpleObject;
  "util/llm": typeof util_llm;
  "util/llmConfig": typeof util_llmConfig;
  "util/minheap": typeof util_minheap;
  "util/object": typeof util_object;
  "util/sleep": typeof util_sleep;
  "util/types": typeof util_types;
  "util/worldLocale": typeof util_worldLocale;
  "util/xxhash": typeof util_xxhash;
  world: typeof world;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
