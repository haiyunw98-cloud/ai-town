import { conversationAction } from './conversationAccess';

describe('human conversation access', () => {
  test('allows a human observer to interrupt an AI-to-AI conversation', () => {
    expect(
      conversationAction({
        isMe: false,
        hasHumanPlayer: true,
        humanIsBusy: false,
        residentIsBusy: true,
        residentConversationHasHuman: false,
      }),
    ).toBe('interrupt');
  });

  test('does not interrupt another human conversation', () => {
    expect(
      conversationAction({
        isMe: false,
        hasHumanPlayer: true,
        humanIsBusy: false,
        residentIsBusy: true,
        residentConversationHasHuman: true,
      }),
    ).toBe('unavailable');
  });
});
