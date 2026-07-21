import {
  canHumanReplaceConversation,
  canHumanPreemptConversation,
  shouldEnterConversationImmediately,
  shouldAutoAcceptHumanInvite,
} from './conversationPriority';

describe('conversation priority', () => {
  test('human players can preempt AI-only conversations', () => {
    expect(canHumanPreemptConversation(true, false)).toBe(true);
  });

  test('AI agents and occupied human conversations cannot be preempted', () => {
    expect(canHumanPreemptConversation(false, false)).toBe(false);
    expect(canHumanPreemptConversation(true, true)).toBe(false);
  });

  test('AI residents immediately accept a human-created conversation', () => {
    expect(shouldAutoAcceptHumanInvite(true, true)).toBe(true);
    expect(shouldAutoAcceptHumanInvite(false, true)).toBe(false);
    expect(shouldAutoAcceptHumanInvite(true, false)).toBe(false);
  });

  test('god-mode observer conversations begin immediately without walking together', () => {
    expect(shouldEnterConversationImmediately(true, true)).toBe(true);
    expect(shouldEnterConversationImmediately(true, false)).toBe(false);
    expect(shouldEnterConversationImmediately(false, true)).toBe(false);
  });

  test('god-mode observer may switch directly from one resident to another', () => {
    expect(canHumanReplaceConversation(true, false)).toBe(true);
    expect(canHumanReplaceConversation(true, true)).toBe(false);
    expect(canHumanReplaceConversation(false, false)).toBe(false);
  });
});
