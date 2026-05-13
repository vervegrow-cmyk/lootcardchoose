import {
  DEFAULT_BASE_PRICE,
  KEYWORD_ADJUSTMENTS,
  MAX_SINGLE_ADJUSTMENT,
  MIN_FINAL_PRICE,
  RARITY_ADJUSTMENTS,
} from "../config/pricing.rules";

export type PricingTier = "floor" | "standard" | "premium";

export type PricingBreakdownItem = {
  rule: string;
  amount: number;
  reason: string;
};

export type CardPricingInput = {
  galleryPrice?: number | string | null;
  metadataPrice?: number | string | null;
  title?: string;
  description?: string | null;
  tags?: string[];
  style?: string | null;
  rarity?: string | null;
  category?: string | null;
  character?: string | null;
  color?: string | null;
  marketingTitle?: string | null;
};

export type CardPricingResult = {
  basePrice: number;
  adjustment: number;
  finalPrice: number;
  pricingTier: PricingTier;
  breakdown: PricingBreakdownItem[];
};

const roundToCents = (value: number): number => Math.round(value * 100) / 100;

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizePrice = (value: number | string | null | undefined): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? roundToCents(value) : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? roundToCents(parsed) : null;
  }

  return null;
};

const resolveBasePrice = (input: CardPricingInput): number =>
  normalizePrice(input.galleryPrice) ?? normalizePrice(input.metadataPrice) ?? DEFAULT_BASE_PRICE;

const buildMatchText = (input: CardPricingInput): string =>
  [
    input.title,
    input.description,
    ...(input.tags ?? []),
    input.style,
    input.rarity,
    input.category,
    input.character,
    input.color,
    input.marketingTitle,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");

const clampAdjustment = (value: number): number =>
  Math.max(-MAX_SINGLE_ADJUSTMENT, Math.min(MAX_SINGLE_ADJUSTMENT, value));

export const cardPricingService = {
  calculate(input: CardPricingInput): CardPricingResult {
    const basePrice = resolveBasePrice(input);
    const breakdown: PricingBreakdownItem[] = [];
    const matchText = buildMatchText(input);
    const rarity = normalizeText(input.rarity).toUpperCase() as keyof typeof RARITY_ADJUSTMENTS;

    if (rarity && rarity in RARITY_ADJUSTMENTS) {
      breakdown.push({
        rule: `rarity.${rarity}`,
        amount: RARITY_ADJUSTMENTS[rarity],
        reason: `${rarity} rarity uplift`,
      });
    }

    for (const rule of KEYWORD_ADJUSTMENTS) {
      if (matchText.includes(rule.keyword)) {
        breakdown.push({
          rule: `keyword.${rule.keyword.replace(/\s+/g, "_")}`,
          amount: rule.amount,
          reason: rule.reason,
        });
      }
    }

    const rawAdjustment = roundToCents(breakdown.reduce((sum, item) => sum + item.amount, 0));
    const adjustment = roundToCents(clampAdjustment(rawAdjustment));

    if (adjustment !== rawAdjustment) {
      breakdown.push({
        rule: "clamp.adjustment",
        amount: roundToCents(adjustment - rawAdjustment),
        reason: `Adjustment clamped to +/- ${MAX_SINGLE_ADJUSTMENT.toFixed(2)}`,
      });
    }

    let finalPrice = roundToCents(basePrice + adjustment);
    if (!Number.isFinite(finalPrice) || finalPrice < 0) {
      finalPrice = DEFAULT_BASE_PRICE;
    }

    if (finalPrice < MIN_FINAL_PRICE) {
      breakdown.push({
        rule: "floor.min_price",
        amount: roundToCents(MIN_FINAL_PRICE - finalPrice),
        reason: `Enforced minimum price of ${MIN_FINAL_PRICE.toFixed(2)}`,
      });
      finalPrice = MIN_FINAL_PRICE;
    }

    const pricingTier: PricingTier =
      finalPrice <= MIN_FINAL_PRICE
        ? "floor"
        : adjustment >= 0.8
          ? "premium"
          : "standard";

    return {
      basePrice: roundToCents(basePrice),
      adjustment,
      finalPrice: roundToCents(finalPrice),
      pricingTier,
      breakdown,
    };
  },
};
