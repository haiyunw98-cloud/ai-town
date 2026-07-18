import {
  chooseNeed,
  eligibleNeedActions,
  eventReward,
  settlePurchase,
  settleWork,
} from './townEconomyRules';

describe('settleWork', () => {
  test('pays only available institution cash and adds whole stock output', () => {
    expect(
      settleWork(
        { residentBalance: 100, institutionCash: 200, stock: 4 },
        { pay: 12, output: 2 },
      ),
    ).toEqual({ residentBalance: 112, institutionCash: 188, stock: 6 });

    expect(
      settleWork(
        { residentBalance: 100, institutionCash: 5, stock: 4 },
        { pay: 12, output: 2 },
      ),
    ).toEqual({ residentBalance: 105, institutionCash: 0, stock: 6 });
  });

  test.each([
    { pay: -1, output: 2 },
    { pay: Number.NaN, output: 2 },
    { pay: Number.POSITIVE_INFINITY, output: 2 },
    { pay: 12, output: -1 },
    { pay: 12, output: 1.5 },
    { pay: 12, output: Number.MAX_SAFE_INTEGER + 1 },
    { pay: 12, output: Number.NaN },
    { pay: 12, output: Number.POSITIVE_INFINITY },
  ])('does not settle invalid work input $pay/$output', (input) => {
    expect(
      settleWork({ residentBalance: 100, institutionCash: 200, stock: 4 }, input),
    ).toEqual({ residentBalance: 100, institutionCash: 200, stock: 4 });
  });

  test('never returns negative balances or stock from corrupt state', () => {
    expect(
      settleWork(
        { residentBalance: -5, institutionCash: -20, stock: -4 },
        { pay: 12, output: 2 },
      ),
    ).toEqual({ residentBalance: 0, institutionCash: 0, stock: 2 });
  });
});

describe('settlePurchase', () => {
  const state = { residentBalance: 20, institutionCash: 30, stock: 3 };

  test('settles a purchase atomically', () => {
    expect(settlePurchase(state, { price: 6, quantity: 1 })).toEqual({
      ok: true,
      residentBalance: 14,
      institutionCash: 36,
      stock: 2,
    });
  });

  test.each([
    { price: 6, quantity: 0 },
    { price: 6, quantity: -1 },
    { price: 6, quantity: 1.5 },
    { price: 6, quantity: Number.MAX_SAFE_INTEGER + 1 },
    { price: 6, quantity: Number.NaN },
    { price: 6, quantity: Number.POSITIVE_INFINITY },
    { price: 0, quantity: 1 },
    { price: -1, quantity: 1 },
    { price: Number.NaN, quantity: 1 },
    { price: Number.POSITIVE_INFINITY, quantity: 1 },
  ])('refuses invalid price or quantity $price/$quantity without mutation', (input) => {
    expect(settlePurchase(state, input)).toEqual({ ok: false, ...state });
  });

  test('refuses insufficient funds or stock without partial mutation', () => {
    expect(
      settlePurchase(
        { residentBalance: 2, institutionCash: 30, stock: 3 },
        { price: 6, quantity: 1 },
      ),
    ).toEqual({ ok: false, residentBalance: 2, institutionCash: 30, stock: 3 });
    expect(settlePurchase(state, { price: 6, quantity: 4 })).toEqual({
      ok: false,
      ...state,
    });
  });

  test('sanitizes corrupt state and never returns negative balances or stock', () => {
    expect(
      settlePurchase(
        { residentBalance: -2, institutionCash: -30, stock: -3 },
        { price: 6, quantity: 1 },
      ),
    ).toEqual({ ok: false, residentBalance: 0, institutionCash: 0, stock: 0 });
  });
});

describe('eventReward', () => {
  test('pays fixed cumulative daily event rewards', () => {
    expect(eventReward({ participated: true, finalist: false, champion: false })).toBe(10);
    expect(eventReward({ participated: true, finalist: true, champion: false })).toBe(30);
    expect(eventReward({ participated: true, finalist: true, champion: true })).toBe(80);
  });

  test('pays only the explicitly earned tiers', () => {
    expect(eventReward({ participated: false, finalist: false, champion: false })).toBe(0);
    expect(eventReward({ participated: false, finalist: true, champion: true })).toBe(70);
  });
});

describe('chooseNeed', () => {
  test('prioritizes affordable food before rest and optional activity', () => {
    expect(chooseNeed({ hunger: 15, energy: 15, balance: 20 })).toBe('food');
    expect(chooseNeed({ hunger: 70, energy: 15, balance: 20 })).toBe('rest');
    expect(chooseNeed({ hunger: 70, energy: 80, balance: 20 })).toBe('normal');
  });

  test('rests when hungry but unable to afford food', () => {
    expect(chooseNeed({ hunger: 15, energy: 15, balance: 3 })).toBe('rest');
    expect(chooseNeed({ hunger: 15, energy: 80, balance: 3 })).toBe('normal');
  });

  test('leaves multiple choices available when no survival need is critical', () => {
    expect(eligibleNeedActions({ hunger: 70, energy: 80, balance: 20 })).toEqual([
      'food',
      'rest',
      'normal',
    ]);
  });

  test('removes only unaffordable food from otherwise optional choices', () => {
    expect(eligibleNeedActions({ hunger: 70, energy: 80, balance: 3 })).toEqual([
      'rest',
      'normal',
    ]);
  });

  test('restricts choices only for an affordable critical need', () => {
    expect(eligibleNeedActions({ hunger: 15, energy: 80, balance: 20 })).toEqual(['food']);
    expect(eligibleNeedActions({ hunger: 70, energy: 15, balance: 20 })).toEqual(['rest']);
  });
});
