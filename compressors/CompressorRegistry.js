export class CompressorRegistry {
    constructor() {
        this.compressors = [];
    }

    /**
     * Registers a compressor instance.
     * Compressors are evaluated in the order they are registered.
     * @param {BaseCompressor} compressor 
     */
    register(compressor) {
        this.compressors.push(compressor);
    }

    /**
     * Gets the first compressor that can handle the file
     * @param {File} file 
     * @returns {BaseCompressor|null}
     */
    getCompressor(file) {
        for (const compressor of this.compressors) {
            if (compressor.canHandle(file)) {
                return compressor;
            }
        }
        return null; // This should not happen if a PassthroughCompressor is registered last
    }
}
