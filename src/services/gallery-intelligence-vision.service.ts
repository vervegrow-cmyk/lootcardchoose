import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/env";
import type { GalleryIntelligenceVisionResponse } from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const FALLBACK_VISION_MODELS = ["Qwen/Qwen3-VL-8B-Instruct"];

type VisionChatMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
      >;
};

type VisionChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

const SYSTEM_PROMPT = `You are LootCardChoose's gallery intelligence enrichment analyzer.
This is a metadata intelligence layer, not a base metadata regeneration task.
Analyze the image first, use the provided gallery metadata only as grounding context, and return one strict JSON object only.
Do not return markdown.
Do not return code fences.
Do not explain anything.
Do not regenerate or overwrite top-level gallery metadata fields such as title, description, tags, style, rarity, category, character, color, mood, scene, or price.`;

const buildUserPrompt = (metadata: GalleryImageMetadata): string => `Analyze this collectible card image and return strict JSON only.

The image is the primary source of truth.
The existing metadata below is only grounding context and may be incomplete or noisy:
${JSON.stringify(
  {
    title: metadata.title ?? null,
    description: metadata.description ?? null,
    tags: metadata.tags ?? [],
    style: metadata.style ?? null,
    rarity: metadata.rarity ?? null,
    category: metadata.category ?? null,
    character: metadata.character ?? null,
    color: metadata.color ?? null,
    mood: metadata.mood ?? null,
    scene: metadata.scene ?? null,
  },
  null,
  2
)}

The JSON must match this schema exactly:
{
  "intelligence": {
    "confidence": number,
    "visualLayer": {
      "primaryColors": string[],
      "styleTags": string[],
      "compositionTags": string[],
      "subjectFocus": string,
      "raritySignals": string[]
    },
    "emotionalLayer": {
      "moodTags": string[],
      "toneTags": string[],
      "energyLevel": "low" | "medium" | "high",
      "dramaticIntensity": number
    },
    "characterLayer": {
      "entityType": string,
      "genderPresentation": string,
      "agePresentation": string,
      "archetypeTags": string[],
      "poseTags": string[]
    },
    "worldbuildingLayer": {
      "settingTags": string[],
      "genreTags": string[],
      "factionTags": string[],
      "propTags": string[],
      "powerSystemTags": string[]
    },
    "commerceLayer": {
      "searchKeywords": string[],
      "collectorHooks": string[],
      "marketingAngles": string[],
      "audienceTags": string[],
      "safetyFlags": string[]
    }
  },
  "commerceNaming": {
    "displayTitle": string,
    "shopifyTitle": string,
    "shortName": string,
    "slug": string,
    "confidence": number
  }
}

Rules:
- Return English-only short phrases for tag arrays.
- Keep taxonomy stable and searchable.
- Use the image as primary evidence and only use existing metadata as grounding.
- Never return markdown or explanations.
- Never return top-level metadata fields.
- Keep titles natural and commerce-friendly.
- slug must be ASCII lowercase kebab-case.
- confidence and dramaticIntensity must be between 0 and 1.
- Return JSON only.`;

const sanitizeJsonString = (value: string): string =>
  value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");

const normalizeRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Vision JSON field "${field}" must be a string`);
  }
  return value.trim();
};

const normalizeStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Vision JSON field "${field}" must be a string array`);
  }
  return value.map((item, index) => normalizeRequiredString(item, `${field}[${index}]`));
};

const normalizeLayerObject = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`Vision JSON field "${field}" must be an object`);
  }
  return value as Record<string, unknown>;
};

const parseJsonResponse = (content: string): GalleryIntelligenceVisionResponse => {
  const parsed = JSON.parse(sanitizeJsonString(content)) as Record<string, unknown>;
  const intelligence = normalizeLayerObject(parsed.intelligence, "intelligence");
  const commerceNaming = normalizeLayerObject(parsed.commerceNaming, "commerceNaming");
  const visualLayer = normalizeLayerObject(intelligence.visualLayer, "intelligence.visualLayer");
  const emotionalLayer = normalizeLayerObject(intelligence.emotionalLayer, "intelligence.emotionalLayer");
  const characterLayer = normalizeLayerObject(intelligence.characterLayer, "intelligence.characterLayer");
  const worldbuildingLayer = normalizeLayerObject(
    intelligence.worldbuildingLayer,
    "intelligence.worldbuildingLayer"
  );
  const commerceLayer = normalizeLayerObject(intelligence.commerceLayer, "intelligence.commerceLayer");

  const intelligenceConfidence = intelligence.confidence;
  const namingConfidence = commerceNaming.confidence;
  const dramaticIntensity = emotionalLayer.dramaticIntensity;

  if (typeof intelligenceConfidence !== "number" || Number.isNaN(intelligenceConfidence)) {
    throw new Error('Vision JSON field "intelligence.confidence" must be a number');
  }
  if (typeof namingConfidence !== "number" || Number.isNaN(namingConfidence)) {
    throw new Error('Vision JSON field "commerceNaming.confidence" must be a number');
  }
  if (typeof dramaticIntensity !== "number" || Number.isNaN(dramaticIntensity)) {
    throw new Error('Vision JSON field "intelligence.emotionalLayer.dramaticIntensity" must be a number');
  }

  return {
    intelligence: {
      confidence: intelligenceConfidence,
      visualLayer: {
        primaryColors: normalizeStringArray(visualLayer.primaryColors, "intelligence.visualLayer.primaryColors"),
        styleTags: normalizeStringArray(visualLayer.styleTags, "intelligence.visualLayer.styleTags"),
        compositionTags: normalizeStringArray(visualLayer.compositionTags, "intelligence.visualLayer.compositionTags"),
        subjectFocus: normalizeRequiredString(visualLayer.subjectFocus, "intelligence.visualLayer.subjectFocus"),
        raritySignals: normalizeStringArray(visualLayer.raritySignals, "intelligence.visualLayer.raritySignals"),
      },
      emotionalLayer: {
        moodTags: normalizeStringArray(emotionalLayer.moodTags, "intelligence.emotionalLayer.moodTags"),
        toneTags: normalizeStringArray(emotionalLayer.toneTags, "intelligence.emotionalLayer.toneTags"),
        energyLevel: normalizeRequiredString(
          emotionalLayer.energyLevel,
          "intelligence.emotionalLayer.energyLevel"
        ) as "low" | "medium" | "high",
        dramaticIntensity,
      },
      characterLayer: {
        entityType: normalizeRequiredString(characterLayer.entityType, "intelligence.characterLayer.entityType"),
        genderPresentation: normalizeRequiredString(
          characterLayer.genderPresentation,
          "intelligence.characterLayer.genderPresentation"
        ),
        agePresentation: normalizeRequiredString(
          characterLayer.agePresentation,
          "intelligence.characterLayer.agePresentation"
        ),
        archetypeTags: normalizeStringArray(characterLayer.archetypeTags, "intelligence.characterLayer.archetypeTags"),
        poseTags: normalizeStringArray(characterLayer.poseTags, "intelligence.characterLayer.poseTags"),
      },
      worldbuildingLayer: {
        settingTags: normalizeStringArray(worldbuildingLayer.settingTags, "intelligence.worldbuildingLayer.settingTags"),
        genreTags: normalizeStringArray(worldbuildingLayer.genreTags, "intelligence.worldbuildingLayer.genreTags"),
        factionTags: normalizeStringArray(worldbuildingLayer.factionTags, "intelligence.worldbuildingLayer.factionTags"),
        propTags: normalizeStringArray(worldbuildingLayer.propTags, "intelligence.worldbuildingLayer.propTags"),
        powerSystemTags: normalizeStringArray(
          worldbuildingLayer.powerSystemTags,
          "intelligence.worldbuildingLayer.powerSystemTags"
        ),
      },
      commerceLayer: {
        searchKeywords: normalizeStringArray(commerceLayer.searchKeywords, "intelligence.commerceLayer.searchKeywords"),
        collectorHooks: normalizeStringArray(commerceLayer.collectorHooks, "intelligence.commerceLayer.collectorHooks"),
        marketingAngles: normalizeStringArray(
          commerceLayer.marketingAngles,
          "intelligence.commerceLayer.marketingAngles"
        ),
        audienceTags: normalizeStringArray(commerceLayer.audienceTags, "intelligence.commerceLayer.audienceTags"),
        safetyFlags: normalizeStringArray(commerceLayer.safetyFlags, "intelligence.commerceLayer.safetyFlags"),
      },
    },
    commerceNaming: {
      displayTitle: normalizeRequiredString(commerceNaming.displayTitle, "commerceNaming.displayTitle"),
      shopifyTitle: normalizeRequiredString(commerceNaming.shopifyTitle, "commerceNaming.shopifyTitle"),
      shortName: normalizeRequiredString(commerceNaming.shortName, "commerceNaming.shortName"),
      slug: normalizeRequiredString(commerceNaming.slug, "commerceNaming.slug"),
      confidence: namingConfidence,
    },
  };
};

const getResponseContent = (response: VisionChatResponse): string => {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }
  throw new Error("Empty vision response");
};

const extractShortErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string; error?: { message?: string } };
    return payload.error?.message?.slice(0, 200) || payload.message?.slice(0, 200) || response.statusText;
  } catch {
    return response.statusText;
  }
};

const ensureSupportedImage = (imagePath: string): void => {
  const extension = path.extname(imagePath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported image type: ${extension || "unknown"}`);
  }
};

const imageToDataUrl = async (imagePath: string): Promise<string> => {
  ensureSupportedImage(imagePath);
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === ".jpg" ? "image/jpeg" : `image/${extension.slice(1)}`;
  const buffer = await readFile(imagePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

class GalleryIntelligenceVisionService {
  async analyzeImage(imagePath: string, metadata: GalleryImageMetadata): Promise<GalleryIntelligenceVisionResponse> {
    const env = loadEnv();
    if (!env.siliconflowApiKey) {
      throw new Error("SILICONFLOW_API_KEY is missing");
    }

    const imageDataUrl = await imageToDataUrl(imagePath);
    const url = `${env.siliconflowBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const modelsToTry = [
      env.siliconflowVisionModel,
      ...FALLBACK_VISION_MODELS.filter((model) => model !== env.siliconflowVisionModel),
    ];
    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      console.log(`[GALLERY INTELLIGENCE VISION] request model=${model}`);
      const messages: VisionChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
            { type: "text", text: buildUserPrompt(metadata) },
          ],
        },
      ];

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.siliconflowApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const shortError = await extractShortErrorMessage(response);
        lastError = new Error(`SiliconFlow API failed status=${response.status} error=${shortError}`);

        const shouldRetryModel =
          (response.status === 400 && /model does not exist/i.test(shortError)) ||
          (response.status === 403 && /model disabled/i.test(shortError));

        if (shouldRetryModel && model !== modelsToTry[modelsToTry.length - 1]) {
          console.error(
            `[GALLERY INTELLIGENCE VISION] model unavailable model=${model} status=${response.status} error=${shortError}`
          );
          continue;
        }

        throw lastError;
      }

      const payload = (await response.json()) as VisionChatResponse;
      const result = parseJsonResponse(getResponseContent(payload));
      console.log(
        `[GALLERY INTELLIGENCE VISION] success displayTitle=${result.commerceNaming.displayTitle || "unknown"}`
      );
      return result;
    }

    throw lastError ?? new Error("SiliconFlow API request failed");
  }
}

export const galleryIntelligenceVisionService = new GalleryIntelligenceVisionService();

