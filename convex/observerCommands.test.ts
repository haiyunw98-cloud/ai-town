import { jest } from '@jest/globals';
import { resolveObserverCommand } from './observerCommands';
import { issueObserverCommand } from './world';

describe('observer command resolution', () => {
  test('sends each resident to their actual workplace', () => {
    expect(resolveObserverCommand('work', '沈砚')).toEqual(expect.objectContaining({
      destination: { x: 5, y: 7 },
      description: expect.stringContaining('灯塔书院'),
    }));
    expect(resolveObserverCommand('work', '唐果')).toEqual(expect.objectContaining({
      destination: { x: 5, y: 20 },
      description: expect.stringContaining('听雨茶庄'),
    }));
  });

  test.each([
    ['rest', { x: 5, y: 20 }],
    ['eat', { x: 8, y: 24 }],
    ['shop', { x: 15, y: 20 }],
    ['plaza', { x: 22, y: 15 }],
  ] as const)('resolves %s to a meaningful town location', (command, destination) => {
    expect(resolveObserverCommand(command, '林澜').destination).toEqual(destination);
  });

  test('keeps custom map destinations explicit and bounded', () => {
    expect(resolveObserverCommand('custom', '林澜', { x: 18, y: 14 })).toEqual(
      expect.objectContaining({ destination: { x: 18, y: 14 } }),
    );
    expect(() => resolveObserverCommand('custom', '林澜')).toThrow(/destination/iu);
    expect(() => resolveObserverCommand('custom', '林澜', { x: 999, y: 14 })).toThrow(/bounds/iu);
  });

  test('queues a live command without reading the hot world document', async () => {
    const insert = jest.fn(async (table: string) => `${table}:new`);
    const query = jest.fn((table: string) => {
      let chain: any;
      chain = {
        withIndex: jest.fn((_name: string, callback: (q: { eq: () => unknown }) => unknown) => {
          const q = { eq: jest.fn().mockReturnThis() };
          callback(q);
          return chain;
        }),
        unique: jest.fn(async () => table === 'playerDescriptions'
          ? { worldId: 'world:1', playerId: 'p:0', name: '林澜' }
          : null),
        order: jest.fn(() => chain),
        first: jest.fn(async () => table === 'inputs' ? { number: 8 } : null),
      };
      return chain;
    });
    const get = jest.fn(() => {
      throw new Error('observer commands must not read the hot world document');
    });
    const runAfter = jest.fn(async () => 'scheduled:1');
    const handler = (issueObserverCommand as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<string>;
    })._handler;

    const inputId = await handler({ db: { query, insert, get }, scheduler: { runAfter } }, {
      worldId: 'world:1',
      engineId: 'engine:1',
      residentId: 'p:0',
      command: 'rest',
    });

    expect(inputId).toBe('inputs:new');
    expect(get).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalledWith('worlds');
    expect(query).not.toHaveBeenCalledWith('worldStatus');
    expect(insert).toHaveBeenCalledWith('inputs', expect.objectContaining({
      engineId: 'engine:1', name: 'observerCommand', number: 9,
    }));
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), expect.objectContaining({
      worldId: 'world:1', residentId: 'p:0', kind: 'observer-intervention',
    }));
  });
});
