import {
  eligibleNeedActions,
  eventReward,
  MAX_MONEY,
  MAX_STOCK,
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
    ).toEqual({ ok: true, residentBalance: 112, institutionCash: 188, stock: 6 });

    expect(
      settleWork(
        { residentBalance: 100, institutionCash: 5, stock: 4 },
        { pay: 12, output: 2 },
      ),
    ).toEqual({ ok: true, residentBalance: 105, institutionCash: 0, stock: 6 });
  });

  test.each([
    { pay: -1, output: 2 },
    { pay: 1.5, output: 2 },
    { pay: Number.MIN_VALUE, output: 2 },
    { pay: Number.MAX_VALUE, output: 2 },
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
    ).toEqual({ ok: false, residentBalance: 100, institutionCash: 200, stock: 4 });
  });

  test('explicitly rejects corrupt state without laundering it into a settlement', () => {
    expect(
      settleWork(
        { residentBalance: -5, institutionCash: -20, stock: -4 },
        { pay: 12, output: 2 },
      ),
    ).toEqual({ ok: false, residentBalance: -5, institutionCash: -20, stock: -4 });
    expect(
      settleWork(
        { residentBalance: Number.MAX_VALUE, institutionCash: 20, stock: 4 },
        { pay: 12, output: 2 },
      ),
    ).toEqual({
      ok: false,
      residentBalance: Number.MAX_VALUE,
      institutionCash: 20,
      stock: 4,
    });
  });

  test('rejects work that would exceed bounded exact balances or stock', () => {
    expect(
      settleWork(
        { residentBalance: MAX_MONEY, institutionCash: 20, stock: 4 },
        { pay: 1, output: 1 },
      ),
    ).toEqual({
      ok: false,
      residentBalance: MAX_MONEY,
      institutionCash: 20,
      stock: 4,
    });
    expect(
      settleWork(
        { residentBalance: 100, institutionCash: 20, stock: MAX_STOCK },
        { pay: 1, output: 1 },
      ),
    ).toEqual({
      ok: false,
      residentBalance: 100,
      institutionCash: 20,
      stock: MAX_STOCK,
    });
  });

  test('cannot inherit a stale success flag when rejecting a chained settlement', () => {
    const first = settleWork(
      { residentBalance: 100, institutionCash: 200, stock: 4 },
      { pay: 12, output: 2 },
    );
    expect(first.ok).toBe(true);
    expect(settleWork(first, { pay: Number.MAX_VALUE, output: 2 }).ok).toBe(false);
    expect(settlePurchase(first, { price: Number.MIN_VALUE, quantity: 1 }).ok).toBe(
      false,
    );
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
    { price: 1.5, quantity: 1 },
    { price: Number.MIN_VALUE, quantity: 1 },
    { price: Number.MAX_VALUE, quantity: 1 },
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

  test('explicitly rejects corrupt state without laundering its balances', () => {
    expect(
      settlePurchase(
        { residentBalance: -2, institutionCash: -30, stock: -3 },
        { price: 6, quantity: 1 },
      ),
    ).toEqual({ ok: false, residentBalance: -2, institutionCash: -30, stock: -3 });
  });

  test('rejects a purchase that would exceed the institution money bound', () => {
    expect(
      settlePurchase(
        { residentBalance: 20, institutionCash: MAX_MONEY, stock: 3 },
        { price: 6, quantity: 1 },
      ),
    ).toEqual({
      ok: false,
      residentBalance: 20,
      institutionCash: MAX_MONEY,
      stock: 3,
    });
  });

  test('conserves total money in every successful transfer', () => {
    const work = settleWork(
      { residentBalance: 100, institutionCash: 200, stock: 4 },
      { pay: 12, output: 2 },
    );
    const purchase = settlePurchase(
      { residentBalance: 20, institutionCash: 30, stock: 3 },
      { price: 6, quantity: 1 },
    );
    expect(work.ok && work.residentBalance + work.institutionCash).toBe(300);
    expect(purchase.ok && purchase.residentBalance + purchase.institutionCash).toBe(50);
  });
});

describe('eventReward', () => {
  test('pays fixed cumulative daily event rewards', () => {
    expect(eventReward({ participated: true, finalist: false, champion: false })).toBe(10);
    expect(eventReward({ participated: true, finalist: true, champion: false })).toBe(30);
    expect(eventReward({ participated: true, finalist: true, champion: true })).toBe(80);
  });

  test('normalizes inconsistent flags to the cumulative achievement hierarchy', () => {
    expect(eventReward({ participated: false, finalist: false, champion: false })).toBe(0);
    expect(eventReward({ participated: false, finalist: true, champion: false })).toBe(30);
    expect(eventReward({ participated: false, finalist: false, champion: true })).toBe(80);
    expect(eventReward({ participated: false, finalist: true, champion: true })).toBe(80);
  });
});

describe('eligibleNeedActions', () => {
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

  test('keeps food and rest both eligible when both needs are critical', () => {
    expect(eligibleNeedActions({ hunger: 15, energy: 15, balance: 20 })).toEqual([
      'food',
      'rest',
    ]);
  });

  test('restricts choices only for a single affordable critical need', () => {
    expect(eligibleNeedActions({ hunger: 15, energy: 80, balance: 20 })).toEqual(['food']);
    expect(eligibleNeedActions({ hunger: 70, energy: 15, balance: 20 })).toEqual(['rest']);
  });
});
