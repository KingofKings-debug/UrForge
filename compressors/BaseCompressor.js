export class BaseCompressor {
    /**
     * Determines if this compressor can handle the given file
     * @param {File} file 
     * @returns {boolean}
     */
    canHandle(file) {
        throw new Error('canHandle must be implemented');
    }

    /**
     * Estimates the size of the compressed file
     * @param {File} file 
     * @param {Object} options 
     * @returns {number} Estimated size in bytes
     */
    estimateSize(file, options) {
        throw new Error('estimateSize must be implemented');
    }

    /**
     * Compresses the file
     * @param {File} file 
     * @param {Object} options 
     * @param {Function} onProgress 
     * @returns {Promise<File>} Compressed file
     */
    async compress(file, options, onProgress) {
        throw new Error('compress must be implemented');
    }
}
