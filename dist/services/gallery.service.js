"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.galleryService = void 0;
const gallery_repository_1 = require("../repositories/gallery.repository");
const logger_1 = require("../utils/logger");
const toDto = (card) => {
    return {
        id: card.id,
        title: card.title,
        description: card.description,
        imageUrl: card.imageUrl,
        tags: card.tags,
        style: card.style,
        rarity: card.rarity,
        category: card.category,
        character: card.character,
        color: card.color,
        price: Number(card.price),
    };
};
const stopWords = new Set(["给我", "张", "卡牌", "卡", "找图", "找卡", "要", "的"]);
const extractKeywords = (query) => {
    const tokens = query.match(/[\u4e00-\u9fa5]+|[a-zA-Z0-9]+/g) ?? [];
    return tokens
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .filter((token) => !stopWords.has(token))
        .map((token) => token.toLowerCase());
};
exports.galleryService = {
    async searchGalleryCards(query, limit = 10) {
        logger_1.logger.info("[GALLERY SERVICE] search query=" + query);
        const keywords = extractKeywords(query);
        const results = await gallery_repository_1.galleryRepository.findManyByQuery({ keywords, limit });
        if (results.length === 0 && keywords.length > 1) {
            const fallback = await gallery_repository_1.galleryRepository.findManyByQuery({
                keywords: [keywords[0]],
                limit,
            });
            return fallback.map(toDto);
        }
        return results.map(toDto);
    },
};
