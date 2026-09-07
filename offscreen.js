import { CompressorRegistry } from './compressors/CompressorRegistry.js';
import { WasmImageCompressor } from './compressors/WasmImageCompressor.js';
import { ImageCompressor } from './compressors/ImageCompressor.js';
import { PassthroughCompressor } from './compressors/PassthroughCompressor.js';

const wasmCompressor = new WasmImageCompressor();
const registry = new CompressorRegistry();
registry.register(new ImageCompressor());
registry.register(new PassthroughCompressor());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen' && message.type === 'COMPRESS_FILE') {
        sendResponse({ ack: true });
        handleCompression(message);
        return true;
    }
});

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function handleCompression(message) {
    try {
        let file;
        const rawData = message.fileData;

        if (!rawData) {
            throw new Error('No fileData provided in COMPRESS_FILE message');
        }

        if (typeof rawData === 'string' && rawData.startsWith('data:')) {
            // Data URL string (100% reliable IPC transfer)
            const res = await fetch(rawData);
            const blob = await res.blob();
            file = new File([blob], message.fileName || 'file', {
                type: message.fileType || blob.type || 'image/jpeg',
                lastModified: Date.now()
            });
        } else if (rawData instanceof ArrayBuffer) {
            file = new File([rawData], message.fileName || 'file', {
                type: message.fileType || 'image/jpeg',
                lastModified: Date.now()
            });
        } else if (ArrayBuffer.isView(rawData)) {
            file = new File([rawData.buffer], message.fileName || 'file', {
                type: message.fileType || 'image/jpeg',
                lastModified: Date.now()
            });
        } else if (typeof rawData === 'object') {
            // Reconstruct byte array in strict index order
            const len = Object.keys(rawData).length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = rawData[i];
            }
            file = new File([bytes.buffer], message.fileName || 'file', {
                type: message.fileType || 'image/jpeg',
                lastModified: Date.now()
            });
        } else {
            throw new Error('Unrecognized fileData format');
        }

        const engine = message.options && message.options.engine;
        let compressor;
        
        if (engine === 'wasm' && wasmCompressor.canHandle(file)) {
            compressor = wasmCompressor;
        } else {
            compressor = registry.getCompressor(file);
        }
        
        if (!compressor) {
            throw new Error('No compressor found for file');
        }

        const compressedFile = await compressor.compress(file, message.options, (progress) => {
            chrome.runtime.sendMessage({
                type: 'COMPRESSION_PROGRESS',
                tabId: message.tabId,
                requestId: message.requestId,
                progress: progress
            });
        });

        if (!compressedFile || typeof compressedFile.size !== 'number') {
            throw new Error('Compressor did not return a valid File object');
        }

        // Convert output File to Data URL for loss-free message passing
        const dataUrl = await blobToDataUrl(compressedFile);

        chrome.runtime.sendMessage({
            type: 'COMPRESSION_COMPLETE',
            tabId: message.tabId,
            requestId: message.requestId,
            fileName: compressedFile.name || message.fileName || 'compressed_file',
            fileType: compressedFile.type || message.fileType || 'image/jpeg',
            dataUrl: dataUrl
        });

    } catch (error) {
        console.error('[urforge Offscreen] Error during handleCompression:', error);
        chrome.runtime.sendMessage({
            type: 'COMPRESSION_ERROR',
            tabId: message.tabId,
            requestId: message.requestId,
            error: error.message || String(error)
        });
    }
}
