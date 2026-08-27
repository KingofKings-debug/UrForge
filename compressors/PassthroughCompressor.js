import { BaseCompressor } from './BaseCompressor.js';

export class PassthroughCompressor extends BaseCompressor {
    canHandle(file) {
        return true; // Can handle everything as a fallback
    }

    estimateSize(file, options) {
        return file.size; // Size doesn't change
    }

    async compress(file, options, onProgress) {
        if (onProgress) onProgress(1.0);
        return file; // Return the original file
    }
}
