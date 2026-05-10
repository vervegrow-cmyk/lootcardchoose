"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchGallerySkill = void 0;
const gallery_service_1 = require("../../services/gallery.service");
const logger_1 = require("../../utils/logger");
const searchGallerySkill = async (input, context) => {
    void context;
    const limit = input.limit ?? 10;
    logger_1.logger.info("[SEARCH GALLERY SKILL] searching query=" + input.query);
    const results = await gallery_service_1.galleryService.searchGalleryCards(input.query, limit);
    return { results };
};
exports.searchGallerySkill = searchGallerySkill;
