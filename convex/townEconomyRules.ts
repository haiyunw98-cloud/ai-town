export type EconomyState = {
  residentBalance: number;
  institutionCash: number;
  stock: number;
};

export const MAX_MONEY = 1_000_000_000;
export const MAX_STOCK = 1_000_000;

type WorkInput = {
  pay: number;
  output: number;
};

type PurchaseInput = {
  price: number;
  quantity: number;
};

type SettlementResult =
  | (EconomyState & { ok: true })
  | (EconomyState & { ok: false });

export type NeedAction = 'food' | 'rest' | 'normal';

function isWholeAmount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function isValidState(state: EconomyState): boolean {
  return (
    isWholeAmount(state.residentBalance, MAX_MONEY) &&
    isWholeAmount(state.institutionCash, MAX_MONEY) &&
    isWholeAmount(state.stock, MAX_STOCK)
  );
}

function rejected(state: EconomyState): SettlementResult {
  return { ok: false, ...state };
}

export function settleWork(state: EconomyState, input: WorkInput): SettlementResult {
  if (
    !isValidState(state) ||
    !isWholeAmount(input.pay, MAX_MONEY) ||
    !isWholeAmount(input.output, MAX_STOCK)
  ) {
    return rejected(state);
  }

  const paid = Math.min(state.institutionCash, input.pay);
  const residentBalance = state.residentBalance + paid;
  const institutionCash = state.institutionCash - paid;
  const stock = state.stock + input.output;
  if (
    !isWholeAmount(residentBalance, MAX_MONEY) ||
    !isWholeAmount(institutionCash, MAX_MONEY) ||
    !isWholeAmount(stock, MAX_STOCK)
  ) {
    return rejected(state);
  }

  return {
    ok: true,
    residentBalance,
    institutionCash,
    stock,
  };
}

export function settlePurchase(state: EconomyState, input: PurchaseInput): SettlementResult {
  if (
    !isValidState(state) ||
    !isWholeAmount(input.price, MAX_MONEY) ||
    input.price <= 0 ||
    !isWholeAmount(input.quantity, MAX_STOCK) ||
    input.quantity <= 0
  ) {
    return rejected(state);
  }

  const total = input.price * input.quantity;
  const residentBalance = state.residentBalance - total;
  const institutionCash = state.institutionCash + total;
  const stock = state.stock - input.quantity;
  if (
    !isWholeAmount(total, MAX_MONEY) ||
    !isWholeAmount(residentBalance, MAX_MONEY) ||
    !isWholeAmount(institutionCash, MAX_MONEY) ||
    !isWholeAmount(stock, MAX_STOCK)
  ) {
    return rejected(state);
  }

  return {
    ok: true,
    residentBalance,
    institutionCash,
    stock,
  };
}

export function eventReward(input: {
  participated: boolean;
  finalist: boolean;
  champion: boolean;
}): number {
  if (input.champion) return 80;
  if (input.finalist) return 30;
  return input.participated ? 10 : 0;
}

export function eligibleNeedActions(input: {
  hunger: number;
  energy: number;
  balance: number;
}): NeedAction[] {
  const canAffordFood = isWholeAmount(input.balance, MAX_MONEY) && input.balance >= 4;
  const critical: NeedAction[] = [];
  if (input.hunger < 30 && canAffordFood) critical.push('food');
  if (input.energy < 30) {
    critical.push('rest');
  }
  if (critical.length > 0) return critical;
  return canAffordFood ? ['food', 'rest', 'normal'] : ['rest', 'normal'];
}
