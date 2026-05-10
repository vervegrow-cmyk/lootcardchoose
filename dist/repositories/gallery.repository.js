"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.galleryRepository = void 0;
const prisma_service_1 = require("../services/prisma.service");
const logger_1 = require("../utils/logger");
const buildKeywordFilters = (keywords) => {
    return keywords.map((keyword) => ({
        OR: [
            { title: { contains: keyword, mode: "insensitive" } },
            { tags: { has: keyword } },
            { style: { contains: keyword, mode: "insensitive" } },
            { rarity: { contains: keyword, mode: "insensitive" } },
            { category: { contains: keyword, mode: "insensitive" } },
            { character: { contains: keyword, mode: "insensitive" } },
            { color: { contains: keyword, mode: "insensitive" } },
        ],
    }));
};
exports.galleryRepository = {
    async findManyByQuery(query) {
        const limit = query.limit ?? 10;
        const keywords = query.keywords.filter((keyword) => keyword.trim().length > 0);
        logger_1.logger.info("[GALLERY REPOSITORY] prisma search start", { keywords, limit });
        const where = {
            isActive: true,
            AND: keywords.length > 0 ? buildKeywordFilters(keywords) : undefined,
        };
        const results = await prisma_service_1.prisma.galleryCard.findMany({
            where,
            take: limit,
            orderBy: { createdAt: "desc" },
        });
        logger_1.logger.info("[GALLERY REPOSITORY] result count=" + results.length);
        return results;
    },
};
