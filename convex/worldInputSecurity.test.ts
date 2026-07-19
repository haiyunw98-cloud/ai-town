import { readFileSync } from 'node:fs';
import { validatePublicWorldInputName } from './world';

describe('public world input security boundary', () => {
  test.each([
    'moveTo',
    'startConversation',
    'startTyping',
    'acceptInvite',
    'rejectInvite',
    'leaveConversation',
  ])('allows the legitimate player input %s', (name) => {
    expect(validatePublicWorldInputName(name)).toBe(name);
  });

  test.each([
    'finishDoSomething',
    'finishRememberConversation',
    'agentFinishSendingMessage',
    'eventMove',
    'eventTransfer',
    'createAgent',
    'join',
    'leave',
  ])('rejects the internal or privileged input %s', (name) => {
    expect(() => validatePublicWorldInputName(name)).toThrow(/not allowed/iu);
  });

  test('keeps the server agent input mutation off the public API', () => {
    const source = readFileSync('convex/aiTown/main.ts', 'utf8');
    expect(source).toContain('export const sendInput = internalMutation');
    expect(source).not.toContain('export const sendInput = mutation');
  });
});
