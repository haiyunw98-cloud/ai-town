export type ConversationAction = 'start' | 'interrupt' | 'unavailable';

export function conversationAction(input: {
  isMe: boolean;
  hasHumanPlayer: boolean;
  humanIsBusy: boolean;
  residentIsBusy: boolean;
  residentConversationHasHuman: boolean;
}): ConversationAction {
  if (input.isMe || !input.hasHumanPlayer || input.humanIsBusy) return 'unavailable';
  if (!input.residentIsBusy) return 'start';
  return input.residentConversationHasHuman ? 'unavailable' : 'interrupt';
}
