"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logger = {
    info: (message, meta) => {
        if (meta) {
            console.log(message, meta);
            return;
        }
        console.log(message);
    },
    warn: (message, meta) => {
        if (meta) {
            console.warn(message, meta);
            return;
        }
        console.warn(message);
    },
    error: (message, meta) => {
        if (meta) {
            console.error(message, meta);
            return;
        }
        console.error(message);
    },
};
