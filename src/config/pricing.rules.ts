export const DEFAULT_BASE_PRICE = 9.99;
export const MIN_FINAL_PRICE = 9.0;
export const MAX_SINGLE_ADJUSTMENT = 1.0;

export const RARITY_ADJUSTMENTS = {
  UR: 1.0,
  SSR: 0.8,
  SR: 0.5,
  R: 0.2,
} as const;

export const KEYWORD_ADJUSTMENTS = [
  { keyword: "black gold", amount: 0.5, reason: "Black gold styling premium" },
  { keyword: "cyberpunk", amount: 0.4, reason: "Cyberpunk theme premium" },
  { keyword: "dragon", amount: 0.6, reason: "Dragon theme premium" },
  { keyword: "gothic", amount: 0.3, reason: "Gothic style premium" },
  { keyword: "holographic", amount: 0.7, reason: "Holographic finish premium" },
  { keyword: "glow", amount: 0.3, reason: "Glow effect premium" },
  { keyword: "premium", amount: 0.5, reason: "Premium descriptor uplift" },
  { keyword: "legendary", amount: 0.8, reason: "Legendary descriptor uplift" },
] as const;
