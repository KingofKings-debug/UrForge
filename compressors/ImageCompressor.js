import { BaseCompressor } from './BaseCompressor.js';

export class ImageCompressor extends BaseCompressor {
    canHandle(file) {
        if (file.type && file.type.startsWith('image/')) {
            return file.type !== 'image/svg+xml';
        }
        const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
        return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'jfif'].includes(ext);
    }

    estimateSize(file, options) {
        const quality = options.quality || 0.8;
        return file.size * quality;
    }

    async compress(file, options, onProgress) {
        if (onProgress) onProgress(0.1);
        
        const bitmap = await createImageBitmap(file);
        if (onProgress) onProgress(0.3);

        let width = bitmap.width;
        let height = bitmap.height;
        
        if (options.maxWidth && width > options.maxWidth) {
            const ratio = options.maxWidth / width;
            width = options.maxWidth;
            height = height * ratio;
        }

        const canvasWidth = Math.max(1, Math.round(width));
        const canvasHeight = Math.max(1, Math.round(height));

        const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);
        if (onProgress) onProgress(0.7);

        const quality = options.quality || 0.8;
        let type = (options.targetFormat && options.targetFormat !== 'auto') 
            ? options.targetFormat 
            : (options.mimeType || file.type || 'image/jpeg');
        
        // Canvas convertToBlob doesn't support lossy quality for PNG
        if (type === 'image/png' && (!options.targetFormat || options.targetFormat === 'auto')) {
            type = 'image/jpeg';
        }
        
        const blob = await canvas.convertToBlob({ type, quality });
        if (onProgress) onProgress(1.0);

        let ext = 'jpg';
        if (type === 'image/webp') ext = 'webp';
        else if (type === 'image/png') ext = 'png';
        else if (type === 'image/avif') ext = 'avif';
        else if (type === 'image/jpeg') ext = 'jpg';

        let outName = file.name || 'compressed_image';
        const lastDot = outName.lastIndexOf('.');
        if (lastDot !== -1) {
            outName = outName.substring(0, lastDot) + '.' + ext;
        } else {
            outName = outName + '.' + ext;
        }

        return new File([blob], outName, {
            type: type,
            lastModified: Date.now()
        });
    }
}

