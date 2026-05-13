import {
  DEFAULT_BASE_PRICE,
  KEYWORD_ADJUSTMENTS,
  MAX_SINGLE_ADJUSTMENT,
  MAX_TRUSTED_SOURCE_PRICE,
  MIN_SINGLE_ADJUSTMENT,
  MIN_FINAL_PRICE,
  PRICE_DECIMALS,
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
  sourceField: "galleryPrice" | "metadataPrice" | "default";
  sourceTrusted: boolean;
  sourcePriceRaw: number | null;
};

type ResolvedBasePrice = {
  basePrice: number;
  sourceField: "galleryPrice" | "metadataPrice" | "default";
  sourceTrusted: boolean;
  sourcePriceRaw: number | null;
};

const roundToCents = (value: number): number => Math.round(value * 10 ** PRICE_DECIMALS) / 10 ** PRICE_DECIMALS;

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizePrice = (value: number | string | null | undefined): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundToCents(value) : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? roundToCents(parsed) : null;
  }

  return null;
};

const resolveTrustedBasePrice = (
  value: number | string | null | undefined,
  sourceField: "galleryPrice" | "metadataPrice"
): ResolvedBasePrice | null => {
  const normalized = normalizePrice(value);
  if (normalized == null || normalized < 0) {
    return null;
  }

  if (normalized < MIN_FINAL_PRICE) {
    return {
      basePrice: MIN_FINAL_PRICE,
      sourceField,
      sourceTrusted: false,
      sourcePriceRaw: normalized,
    };
  }

  if (normalized <= MAX_TRUSTED_SOURCE_PRICE) {
    return {
      basePrice: normalized,
      sourceField,
      sourceTrusted: true,
      sourcePriceRaw: normalized,
    };
  }

  return null;
};

const resolveBasePrice = (input: CardPricingInput): ResolvedBasePrice =>
  resolveTrustedBasePrice(input.galleryPrice, "galleryPrice") ??
  resolveTrustedBasePrice(input.metadataPrice, "metadataPrice") ?? {
    basePrice: DEFAULT_BASE_PRICE,
    sourceField: "default",
    sourceTrusted: false,
    sourcePriceRaw: null,
  };

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
  Math.max(MIN_SINGLE_ADJUSTMENT, Math.min(MAX_SINGLE_ADJUSTMENT, value));

export const cardPricingService = {
  calculate(input: CardPricingInput): CardPricingResult {
    const resolvedBase = resolveBasePrice(input);
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

    let finalPrice = roundToCents(resolvedBase.basePrice + adjustment);
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
        : adjustment >= MAX_SINGLE_ADJUSTMENT
          ? "premium"
          : "standard";

    return {
      basePrice: roundToCents(resolvedBase.basePrice),
      adjustment,
      finalPrice: roundToCents(finalPrice),
      pricingTier,
      breakdown,
      sourceField: resolvedBase.sourceField,
      sourceTrusted: resolvedBase.sourceTrusted,
      sourcePriceRaw: resolvedBase.sourcePriceRaw,
    };
  },
};
