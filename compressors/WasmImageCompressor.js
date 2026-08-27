import { BaseCompressor } from './BaseCompressor.js';
import encodeJpeg from '@jsquash/jpeg/encode.js';
import encodeWebp from '@jsquash/webp/encode.js';
import encodeAvif from '@jsquash/avif/encode.js';
import encodePng from '@jsquash/png/encode.js';

export class WasmImageCompressor extends BaseCompressor {
    canHandle(file) {
        if (!file) return false;
        if (file.type && file.type.startsWith('image/')) {
            return file.type !== 'image/svg+xml';
        }
        const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
        return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'jfif', 'avif'].includes(ext);
    }

    estimateSize(file, options) {
        const quality = (options && options.quality !== undefined) ? options.quality : 0.6;
        const targetFormat = (options && options.targetFormat) ? options.targetFormat : 'image/webp';
        
        let multiplier = quality * 0.65;
        if (targetFormat === 'image/jpeg') multiplier = quality * 0.85;
        else if (targetFormat === 'image/avif') multiplier = quality * 0.45;
        else if (targetFormat === 'image/png') multiplier = 0.75;
        
        return Math.round(file.size * multiplier);
    }

    async compress(file, options, onProgress) {
        if (onProgress) onProgress(0.1);

        // 1. Convert source file to ImageData via OffscreenCanvas
        let width = 0;
        let height = 0;
        let bitmap = null;

        try {
            bitmap = await createImageBitmap(file);
            width = bitmap.width;
            height = bitmap.height;
        } catch (bmErr) {
            console.warn('[WasmImageCompressor] createImageBitmap failed directly on File, attempting via ArrayBuffer Blob:', bmErr);
            const arrayBuf = await file.arrayBuffer();
            const mimeType = file.type || 'image/jpeg';
            const blob = new Blob([arrayBuf], { type: mimeType });
            bitmap = await createImageBitmap(blob);
            width = bitmap.width;
            height = bitmap.height;
        }

        if (options && options.maxWidth && width > options.maxWidth) {
            const ratio = options.maxWidth / width;
            width = options.maxWidth;
            height = height * ratio;
        }

        const canvasWidth = Math.max(1, Math.round(width));
        const canvasHeight = Math.max(1, Math.round(height));

        const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);
        if (bitmap.close) bitmap.close();

        const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
        if (onProgress) onProgress(0.3);

        // Quality: converts 0.0 - 1.0 (or 10-90) into 1-100 integer
        let qualityVal = (options && options.quality !== undefined) ? options.quality : 0.6;
        if (qualityVal <= 1.0) {
            qualityVal = Math.round(qualityVal * 100);
        }
        const quality = Math.max(1, Math.min(100, Math.round(qualityVal)));

        let targetFormat = (options && options.targetFormat) || 'image/webp';
        if (targetFormat === 'auto') {
            targetFormat = file.type || 'image/webp';
            if (!targetFormat.startsWith('image/')) targetFormat = 'image/webp';
        }

        let compressedBuffer;
        let outExt = 'webp';
        let outMime = 'image/webp';

        if (onProgress) onProgress(0.5);

        try {
            if (targetFormat === 'image/avif' || targetFormat === 'avif') {
                outExt = 'avif';
                outMime = 'image/avif';
                compressedBuffer = await encodeAvif(imageData, { quality });
            } else if (targetFormat === 'image/jpeg' || targetFormat === 'jpg' || targetFormat === 'jpeg') {
                outExt = 'jpg';
                outMime = 'image/jpeg';
                compressedBuffer = await encodeJpeg(imageData, { quality });
            } else if (targetFormat === 'image/png' || targetFormat === 'png') {
                outExt = 'png';
                outMime = 'image/png';
                compressedBuffer = await encodePng(imageData);
            } else {
                // Default to WebP
                outExt = 'webp';
                outMime = 'image/webp';
                compressedBuffer = await encodeWebp(imageData, { quality });
            }
        } catch (encErr) {
            console.warn('[WasmImageCompressor] Encoding error, falling back to WebP:', encErr);
            outExt = 'webp';
            outMime = 'image/webp';
            compressedBuffer = await encodeWebp(imageData, { quality });
        }

        if (onProgress) onProgress(0.95);

        // Compute output filename with new extension
        let outName = file.name || 'compressed_image';
        const lastDot = outName.lastIndexOf('.');
        if (lastDot !== -1) {
            outName = outName.substring(0, lastDot) + '.' + outExt;
        } else {
            outName = outName + '.' + outExt;
        }

        const blob = new Blob([compressedBuffer], { type: outMime });
        if (onProgress) onProgress(1.0);

        return new File([blob], outName, {
            type: outMime,
            lastModified: Date.now()
        });
    }
}
