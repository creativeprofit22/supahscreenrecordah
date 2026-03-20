"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidSavePath = isValidSavePath;
const path_1 = __importDefault(require("path"));
/**
 * Validates a file path to prevent directory traversal attacks.
 * Ensures the resolved path is within one of the allowed directories.
 */
function isValidSavePath(filePath, allowedDirs) {
    if (!filePath || typeof filePath !== 'string') {
        return false;
    }
    const resolved = path_1.default.resolve(filePath);
    return allowedDirs.some((allowedDir) => {
        const normalizedAllowed = path_1.default.resolve(allowedDir);
        return resolved.startsWith(normalizedAllowed + path_1.default.sep) || resolved === normalizedAllowed;
    });
}
//# sourceMappingURL=paths.js.map