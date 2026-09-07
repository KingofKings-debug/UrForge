import { BaseCompressor } from './BaseCompressor.js';

function applyPngQuantization(imageData, quality) {
    if (quality >= 0.98) return imageData;
    const data = imageData.data;
    const len = data.length;
    const levels = Math.max(4, Math.min(256, Math.round(256 * Math.pow(quality, 0.75))));
    const step = 255 / (levels - 1);
    const quantizedData = new Uint8ClampedArray(data);
    for (let i = 0; i < len; i += 4) {
        quantizedData[i] = Math.round(Math.round(quantizedData[i] / step) * step);
        quantizedData[i + 1] = Math.round(Math.round(quantizedData[i + 1] / step) * step);
        quantizedData[i + 2] = Math.round(Math.round(quantizedData[i + 2] / step) * step);
        if (quantizedData[i + 3] < 255 && quantizedData[i + 3] > 0) {
            quantizedData[i + 3] = Math.round(Math.round(quantizedData[i + 3] / step) * step);
        }
    }
    return new ImageData(quantizedData, imageData.width, imageData.height);
}

export class ImageCompressor extends BaseCompressor {
    canHandle(file) {
        if (file.type && file.type.startsWith('image/')) {
            return file.type !== 'image/svg+xml';
        }
        const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
        return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'jfif', 'avif', 'heic', 'heif', 'tiff', 'tif', 'ico', 'pjpeg', 'pjp'].includes(ext);
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
        
        if (type === 'image/png' && quality < 0.98) {
            const imgData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const quantized = applyPngQuantization(imgData, quality);
            ctx.putImageData(quantized, 0, 0);
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

