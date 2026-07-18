export type EconomyState = {
  residentBalance: number;
  institutionCash: number;
  stock: number;
};

type WorkInput = {
  pay: number;
  output: number;
};

type PurchaseInput = {
  price: number;
  quantity: number;
};

type PurchaseResult =
  | (EconomyState & { ok: true })
  | (EconomyState & { ok: false });

export type NeedAction = 'food' | 'rest' | 'normal';

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sanitizeState(state: EconomyState): EconomyState {
  return {
    residentBalance: nonNegativeFinite(state.residentBalance),
    institutionCash: nonNegativeFinite(state.institutionCash),
    stock: Math.floor(nonNegativeFinite(state.stock)),
  };
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function settleWork(state: EconomyState, input: WorkInput): EconomyState {
  const safeState = sanitizeState(state);
  if (
    !isNonNegativeFinite(input.pay) ||
    !Number.isSafeInteger(input.output) ||
    input.output < 0
  ) {
    return safeState;
  }

  const paid = Math.min(safeState.institutionCash, input.pay);
  return {
    residentBalance: safeState.residentBalance + paid,
    institutionCash: safeState.institutionCash - paid,
    stock: safeState.stock + input.output,
  };
}

export function settlePurchase(state: EconomyState, input: PurchaseInput): PurchaseResult {
  const safeState = sanitizeState(state);
  if (
    !Number.isFinite(input.price) ||
    input.price <= 0 ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0
  ) {
    return { ok: false, ...safeState };
  }

  const total = input.price * input.quantity;
  if (
    !Number.isFinite(total) ||
    safeState.residentBalance < total ||
    safeState.stock < input.quantity
  ) {
    return { ok: false, ...safeState };
  }

  return {
    ok: true,
    residentBalance: safeState.residentBalance - total,
    institutionCash: safeState.institutionCash + total,
    stock: safeState.stock - input.quantity,
  };
}

export function eventReward(input: {
  participated: boolean;
  finalist: boolean;
  champion: boolean;
}): number {
  return (input.participated ? 10 : 0) + (input.finalist ? 20 : 0) + (input.champion ? 50 : 0);
}

export function chooseNeed(input: {
  hunger: number;
  energy: number;
  balance: number;
}): NeedAction {
  if (input.hunger < 30 && input.balance >= 4) {
    return 'food';
  }
  if (input.energy < 30) {
    return 'rest';
  }
  return 'normal';
}

export function eligibleNeedActions(input: {
  hunger: number;
  energy: number;
  balance: number;
}): NeedAction[] {
  const canAffordFood = Number.isFinite(input.balance) && input.balance >= 4;
  if (input.hunger < 30 && canAffordFood) {
    return ['food'];
  }
  if (input.energy < 30) {
    return ['rest'];
  }
  return canAffordFood ? ['food', 'rest', 'normal'] : ['rest', 'normal'];
}
