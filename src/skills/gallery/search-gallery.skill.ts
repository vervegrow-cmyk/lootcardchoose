import { SkillContext, SkillHandler } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { GalleryCardDto, GallerySearchResult, galleryService } from "../../services/gallery.service";
import { ParsedGalleryQuery } from "../../services/llm-query-parser.service";
import { logger } from "../../utils/logger";
import { UserFacingError } from "../../utils/user-facing-error";

export type SearchGalleryInput = {
  query: string;
  discordUserId: string;
  discordChannelId: string;
};

export type SearchGalleryOutput = {
  query: string;
  language: SkillContext["language"];
  parsedQuery: ParsedGalleryQuery | null;
  results: GalleryCardDto[];
  limit: number;
};

type SearchSessionWriteTask = {
  discordGuildId?: string | null;
  discordUserId: string;
  discordChannelId: string;
  query: string;
  language: SkillContext["language"];
  resultCount: number;
  results: Array<{
    id: string;
    title: string;
    description: string | null;
    imageUrl: string;
    price: number;
    tags: string[];
    language: SkillContext["language"];
    batchIndex: number;
    originalQuery: string;
  }>;
};

type PendingSearchSessionWriteState = {
  ready: Promise<void>;
  write: Promise<void>;
};

const pendingSearchSessionWrites = new Map<string, PendingSearchSessionWriteState>();

const buildSessionWriteKey = (discordGuildId: string | null | undefined, discordUserId: string, discordChannelId: string): string =>
  `${discordGuildId ?? "null"}:${discordUserId}:${discordChannelId}`;

const scheduleSearchSessionWrite = (task: SearchSessionWriteTask): void => {
  const normalizedGuildId = task.discordGuildId ?? null;
  const key = buildSessionWriteKey(normalizedGuildId, task.discordUserId, task.discordChannelId);
  const previousWrite = pendingSearchSessionWrites.get(key)?.write ?? Promise.resolve();

  let resolveReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const writePromise = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const startedAt = Date.now();
      logger.info("[SEARCH GALLERY SKILL] session create start", {
        discordUserId: task.discordUserId,
        discordChannelId: task.discordChannelId,
        sessionQuery: task.query,
        resultCount: task.resultCount,
      });

      try {
        const createdSession = await gallerySearchSessionRepository.create({
          discordGuildId: normalizedGuildId,
          discordUserId: task.discordUserId,
          discordChannelId: task.discordChannelId,
          query: task.query,
          results: task.results,
          status: "active",
        });
        resolveReady?.();

        const archivedCount = await gallerySearchSessionRepository.archiveOtherActiveSessions({
          discordGuildId: normalizedGuildId,
          discordUserId: task.discordUserId,
          discordChannelId: task.discordChannelId,
          keepSessionId: createdSession.id,
        });

        logger.info("[SEARCH GALLERY SKILL] session create success", {
          discordUserId: task.discordUserId,
          discordChannelId: task.discordChannelId,
          sessionId: createdSession.id,
          archivedCount,
          sessionQuery: task.query,
          resultCount: task.resultCount,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        resolveReady?.();
        logger.warn("[SEARCH GALLERY SKILL] session create failed", {
          discordUserId: task.discordUserId,
          discordChannelId: task.discordChannelId,
          sessionQuery: task.query,
          resultCount: task.resultCount,
          latencyMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

  const state: PendingSearchSessionWriteState = {
    ready,
    write: Promise.resolve(),
  };

  const trackedWrite = writePromise.finally(() => {
    if (pendingSearchSessionWrites.get(key) === state) {
      pendingSearchSessionWrites.delete(key);
    }
  });
  state.write = trackedWrite;

  pendingSearchSessionWrites.set(key, state);
};

export const awaitPendingSearchSessionWrite = async (input: {
  discordGuildId?: string | null;
  discordUserId: string;
  discordChannelId: string;
  timeoutMs: number;
}): Promise<boolean> => {
  const key = buildSessionWriteKey(input.discordGuildId ?? null, input.discordUserId, input.discordChannelId);
  const pendingWrite = pendingSearchSessionWrites.get(key);

  if (!pendingWrite) {
    return true;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<boolean>([
      pendingWrite.ready.then(() => true),
      new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), input.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const searchGallerySkill: SkillHandler<SearchGalleryInput, SearchGalleryOutput> = async (
  input: SearchGalleryInput,
  context: SkillContext
) => {
  logger.info("[SEARCH GALLERY SKILL] searching", {
    query: input.query,
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
  });

  try {
    const searchResult: GallerySearchResult = await galleryService.searchGalleryCards(input.query, context.language);
    const sessionResults = searchResult.results.map((card) => ({
      id: card.id,
      title: card.title,
      description: card.description,
      imageUrl: card.imageUrl,
      price: card.price,
      tags: card.tags,
      language: searchResult.language,
      batchIndex: 1,
      originalQuery: searchResult.query,
    }));

    scheduleSearchSessionWrite({
      discordGuildId: context.discordGuildId,
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      query: searchResult.query,
      language: searchResult.language,
      resultCount: searchResult.results.length,
      results: sessionResults,
    });

    return {
      query: searchResult.query,
      language: searchResult.language,
      parsedQuery: searchResult.parsedQuery,
      results: searchResult.results,
      limit: searchResult.limit,
    };
  } catch (error) {
    logger.error("[SEARCH GALLERY SKILL] search failed", {
      query: input.query,
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      message: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof UserFacingError) {
      throw error;
    }

    const unavailableMessage =
      context.language === "zh"
        ? "图库搜索暂时不可用，请稍后再试。"
        : "The gallery search service is temporarily unavailable. Please try again in a moment.";

    throw new UserFacingError(unavailableMessage, {
      stage: "search",
      code: "gallery.search.unavailable",
    });
  }
};
