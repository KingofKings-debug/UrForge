// content-script.js

// 1. Inject main-world.js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('main-world.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// 2. Setup Shadow DOM Modal
// Global placeholders used by modal callbacks
let originalFiles = [];
let currentFile = null;
let modalContainer, shadowRoot, overlay;
let isDomainExcluded = false;


// Updated initModal with new UI components and event handling
function initModal() {
    if (modalContainer) return;

    // Create container
    modalContainer = document.createElement('div');
    Object.assign(modalContainer.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        pointerEvents: 'none'
    });
    (document.body || document.documentElement).appendChild(modalContainer);

    shadowRoot = modalContainer.attachShadow({ mode: 'closed' });

    // Styles
    const style = document.createElement('style');
    style.textContent = `
        :host {
            all: initial;
            --bg-color: #09090b;
            --surface-color: #18181b;
            --surface-card: #27272a;
            --primary-color: #6366f1;
            --primary-hover: #4f46e5;
            --accent-color: #818cf8;
            --text-color: #f4f4f5;
            --text-muted: #a1a1aa;
            --border-color: #3f3f46;
            --border-radius: 1rem;
            --overlay-bg: rgba(0, 0, 0, 0.75);
            --danger-color: #f43f5e;
            --danger-hover: #e11d48;
            --secondary-bg: #27272a;
            --secondary-hover: #3f3f46;
        }
        .overlay {
            position: fixed;
            inset: 0;
            background: var(--overlay-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            padding: 1rem;
            box-sizing: border-box;
        }
        .modal {
            background: var(--surface-color);
            color: var(--text-color);
            width: 740px;
            max-width: 95vw;
            border-radius: var(--border-radius);
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px var(--border-color);
            display: flex;
            flex-direction: column;
            position: relative;
        }
        
        /* 2-Column Split View Layout */
        .split-container {
            display: flex;
            min-height: 440px;
            width: 100%;
        }
        @media (max-width: 640px) {
            .split-container {
                flex-direction: column;
            }
        }

        /* Left Panel - Preview Stage */
        .left-panel {
            flex: 1.1;
            background: var(--bg-color);
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            border-right: 1px solid var(--border-color);
        }
        .preview-box {
            flex: 1;
            min-height: 260px;
            background: #000000;
            border-radius: 0.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .preview-box img, .preview-box canvas {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        .preview-fallback {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.75rem;
            color: var(--text-muted);
            text-align: center;
            padding: 1rem;
        }
        .preview-icon {
            font-size: 3rem;
        }
        .file-meta-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--surface-card);
            padding: 0.75rem 1rem;
            border-radius: 0.625rem;
            border: 1px solid var(--border-color);
        }
        .file-info-main {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            overflow: hidden;
        }
        .file-name-text {
            font-weight: 600;
            font-size: 0.9rem;
            color: var(--text-color);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .file-sub-text {
            font-size: 0.78rem;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        .badge {
            background: var(--primary-color);
            color: #fff;
            padding: 0.15rem 0.45rem;
            border-radius: 0.25rem;
            font-size: 0.7rem;
            font-weight: 700;
            text-transform: uppercase;
        }

        /* Right Panel - Control Sidebar */
        .right-panel {
            flex: 0.9;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 1.25rem;
            background: var(--surface-color);
        }
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-weight: 600;
            font-size: 1rem;
            color: var(--text-color);
        }
        .close-btn {
            cursor: pointer;
            font-size: 1.1rem;
            color: var(--text-muted);
            transition: color 0.2s;
            line-height: 1;
            padding: 0.25rem;
        }
        .close-btn:hover {
            color: var(--text-color);
        }
        
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .control-label {
            font-size: 0.85rem;
            font-weight: 500;
            color: var(--text-muted);
            display: flex;
            justify-content: space-between;
        }
        
        .slider-container input[type=range] {
            width: 100%;
            -webkit-appearance: none;
            appearance: none;
            height: 6px;
            background: var(--border-color);
            border-radius: 3px;
            outline: none;
            margin: 8px 0;
        }
        .slider-container input[type=range]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: var(--primary-color);
            cursor: pointer;
            margin-top: -6px;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
            transition: transform 0.15 ease, background-color 0.15s ease;
        }
        .slider-container input[type=range]::-webkit-slider-thumb:hover {
            transform: scale(1.15);
            background: var(--accent-color);
        }
        
        .size-stats-card {
            background: var(--bg-color);
            padding: 0.875rem 1rem;
            border-radius: 0.625rem;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
            font-size: 0.825rem;
        }
        .stat-row {
            display: flex;
            justify-content: space-between;
            color: var(--text-muted);
        }
        .stat-val-highlight {
            color: var(--accent-color);
            font-weight: 600;
        }

        .control-select {
            width: 100%;
            background: var(--bg-color);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            border-radius: 0.5rem;
            padding: 0.55rem 0.75rem;
            font-size: 0.85rem;
            outline: none;
            cursor: pointer;
            transition: border-color 0.2s;
        }
        .control-select:focus {
            border-color: var(--primary-color);
        }
        .engine-toggle {
            display: flex;
            background: var(--bg-color);
            padding: 0.25rem;
            border-radius: 0.6rem;
            border: 1px solid var(--border-color);
            gap: 0.25rem;
        }
        .engine-option {
            flex: 1;
            cursor: pointer;
        }
        .engine-option input {
            display: none;
        }
        .engine-pill {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0.45rem 0.5rem;
            border-radius: 0.45rem;
            font-size: 0.775rem;
            font-weight: 600;
            color: var(--text-muted);
            transition: all 0.2s ease;
            user-select: none;
        }
        .engine-option input:checked + .engine-pill {
            background: var(--surface-card);
            color: var(--accent-color);
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .action-stack {
            display: flex;
            flex-direction: column;
            gap: 0.625rem;
        }
        .btn {
            padding: 0.65rem 1rem;
            border: none;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 600;
            transition: all 0.2s ease;
            outline: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        .btn-primary {
            background: var(--primary-color);
            color: #ffffff;
        }
        .btn-primary:hover {
            background: var(--primary-hover);
        }
        .btn-secondary {
            background: var(--secondary-bg);
            color: var(--text-color);
            border: 1px solid var(--border-color);
        }
        .btn-secondary:hover {
            background: var(--secondary-hover);
        }
        .btn-danger {
            background: transparent;
            color: var(--danger-color);
            border: 1px solid rgba(244, 63, 94, 0.4);
            margin-top: 0.25rem;
        }
        .btn-danger:hover {
            background: rgba(244, 63, 94, 0.15);
            border-color: var(--danger-color);
        }

        .hidden {
            display: none !important;
        }
        .manage-link {
            color: var(--text-muted);
            cursor: pointer;
            font-size: 0.75rem;
            text-decoration: underline;
            text-align: center;
            transition: color 0.2s;
        }
        .manage-link:hover {
            color: var(--accent-color);
        }

        /* Exclusions View */
        #exclusions-view {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding: 1.5rem;
            min-height: 380px;
        }
        #exclusions-list-container {
            max-height: 260px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .exclusion-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--bg-color);
            padding: 0.6rem 0.85rem;
            border-radius: 0.5rem;
            font-size: 0.85rem;
            border: 1px solid var(--border-color);
        }
        .exclusion-domain {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 400px;
            color: var(--text-color);
        }
        .btn-remove-exclusion {
            background: transparent;
            color: var(--danger-color);
            border: none;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 600;
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            transition: background-color 0.2s;
        }
        .btn-remove-exclusion:hover {
            background: rgba(244, 63, 94, 0.15);
        }

        /* Progress View */
        #progress-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1.25rem;
            padding: 3.5rem 2rem;
            min-height: 380px;
        }
        .progress-icon {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.75rem;
            animation: pulse-ring 1.8s ease-in-out infinite;
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6);
        }
        @keyframes pulse-ring {
            0%   { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6); }
            70%  { box-shadow: 0 0 0 14px rgba(99, 102, 241, 0); }
            100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
        }
        .progress-label {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-color);
            text-align: center;
        }
        .progress-sub {
            font-size: 0.8rem;
            color: var(--text-muted);
            text-align: center;
            margin-top: -0.75rem;
        }
        .progress-track {
            width: 100%;
            max-width: 400px;
            height: 8px;
            background: var(--bg-color);
            border-radius: 99px;
            overflow: hidden;
            border: 1px solid var(--border-color);
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
            border-radius: 99px;
            width: 0%;
            transition: width 0.3s ease;
        }
        .progress-pct {
            font-size: 2.25rem;
            font-weight: 700;
            color: var(--text-color);
            letter-spacing: -0.05em;
        }
    `;
    shadowRoot.appendChild(style);

    // Build DOM
    overlay = document.createElement('div');
    overlay.className = 'overlay hidden';
    overlay.innerHTML = `
        <div class="modal" id="upload-modal">
            <!-- 2-Column Split View Main Interception -->
            <div id="main-view">
                <div class="split-container">
                    <!-- Left Panel: Preview Stage -->
                    <div class="left-panel">
                        <div class="preview-box" id="preview-area">
                            <!-- dynamic preview injected -->
                        </div>
                        <div class="file-meta-card">
                            <div class="file-info-main">
                                <span class="file-name-text" id="file-name">File Name</span>
                                <div class="file-sub-text">
                                    <span id="file-meta-details">Document • 0 MB</span>
                                </div>
                            </div>
                            <span class="badge" id="file-ext">EXT</span>
                        </div>
                    </div>

                    <!-- Right Panel: Control Sidebar -->
                    <div class="right-panel">
                        <div>
                            <div class="panel-header">
                                <span>⚙️ Optimization Settings</span>
                                <span class="close-btn" id="close-modal">✕</span>
                            </div>
                            
                            <div class="control-group" style="margin-top: 1rem;">
                                <div class="control-label">
                                    <span>Output Format</span>
                                </div>
                                <select id="format-select" class="control-select">
                                    <option value="image/webp" selected>WebP (Recommended)</option>
                                    <option value="image/avif">AVIF (Smallest)</option>
                                    <option value="image/jpeg">JPEG (Universal)</option>
                                    <option value="image/png">PNG (Lossless)</option>
                                    <option value="auto">Same as Original</option>
                                </select>
                            </div>

                            <div class="control-group" style="margin-top: 0.85rem;">
                                <div class="control-label">
                                    <span>Compression Engine</span>
                                </div>
                                <div class="engine-toggle">
                                    <label class="engine-option">
                                        <input type="radio" name="upforge-engine" value="wasm" checked>
                                        <span class="engine-pill">⚡ Pro WASM</span>
                                    </label>
                                    <label class="engine-option">
                                        <input type="radio" name="upforge-engine" value="canvas">
                                        <span class="engine-pill">🖼️ Fast Canvas</span>
                                    </label>
                                </div>
                            </div>

                            <div class="control-group" style="margin-top: 0.85rem;">
                                <div class="control-label">
                                    <span>Quality Level</span>
                                    <span id="range-label-left">60%</span>
                                </div>
                                <div class="slider-container">
                                    <input type="range" id="quality-range" min="10" max="90" step="5" value="60">
                                </div>
                            </div>

                            <div class="size-stats-card" style="margin-top: 1rem;">
                                <div class="stat-row">
                                    <span>Original:</span>
                                    <span id="stat-original-size">0 MB</span>
                                </div>
                                <div class="stat-row">
                                    <span>Estimated:</span>
                                    <span class="stat-val-highlight" id="range-label-right">~0 MB</span>
                                </div>
                            </div>
                        </div>

                        <div class="action-stack">
                            <button class="btn btn-primary" id="btn-compress">
                                ⚡ Compress & Upload
                            </button>
                            <button class="btn btn-secondary" id="btn-keep">
                                📄 Upload Original
                            </button>
                            <button class="btn btn-danger" id="exclude-site">
                                🚫 Never ask on this site
                            </button>
                            <span class="manage-link" id="btn-manage-exclusions">Manage Exclusions</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Exclusions List View -->
            <div id="exclusions-view" class="hidden">
                <div class="panel-header">
                    <span>Excluded Sites</span>
                    <span class="close-btn" id="btn-back-to-main">✕</span>
                </div>
                <div id="exclusions-list-container">
                    <!-- Dynamic list of domains -->
                </div>
            </div>

            <!-- Progress View -->
            <div id="progress-view" class="hidden">
                <div class="progress-icon">⚡</div>
                <div class="progress-pct" id="progress-pct">0%</div>
                <div class="progress-label" id="progress-label">Preparing...</div>
                <div class="progress-sub" id="progress-sub">Please wait while we process your file.</div>
                <div class="progress-track">
                    <div class="progress-fill" id="progress-fill"></div>
                </div>
            </div>
        </div>
    `;
    shadowRoot.appendChild(overlay);

    // Close button handler
    shadowRoot.getElementById('close-modal').onclick = () => {
        console.log('[UpForge] Close button clicked.');
        overlay.classList.add('hidden');
        modalContainer.style.pointerEvents = 'none';
    };

    // Exclusions view handlers
    const mainView = shadowRoot.getElementById('main-view');
    const exclusionsView = shadowRoot.getElementById('exclusions-view');
    const exclusionsContainer = shadowRoot.getElementById('exclusions-list-container');

    shadowRoot.getElementById('btn-manage-exclusions').onclick = () => {
        mainView.classList.add('hidden');
        exclusionsView.classList.remove('hidden');
        renderExclusionsList();
    };

    shadowRoot.getElementById('btn-back-to-main').onclick = () => {
        exclusionsView.classList.add('hidden');
        mainView.classList.remove('hidden');
    };

    function renderExclusionsList() {
        exclusionsContainer.innerHTML = '';
        chrome.storage.sync.get(['excludedDomains'], (res) => {
            const domains = (res && res.excludedDomains) || [];
            if (domains.length === 0) {
                const empty = document.createElement('div');
                empty.style.color = '#71717a';
                empty.style.textAlign = 'center';
                empty.style.padding = '2rem';
                empty.style.fontSize = '0.9rem';
                empty.textContent = 'No sites excluded yet.';
                exclusionsContainer.appendChild(empty);
                return;
            }

            domains.forEach((dom) => {
                const item = document.createElement('div');
                item.className = 'exclusion-item';
                
                const span = document.createElement('span');
                span.className = 'exclusion-domain';
                span.textContent = dom;
                item.appendChild(span);

                const btn = document.createElement('button');
                btn.className = 'btn-remove-exclusion';
                btn.textContent = 'Remove';
                btn.onclick = () => {
                    const index = domains.indexOf(dom);
                    if (index > -1) {
                        domains.splice(index, 1);
                        chrome.storage.sync.set({ excludedDomains: domains }, () => {
                            console.log('[UpForge] Removed domain from exclusions:', dom);
                            if (dom === window.location.hostname) {
                                isDomainExcluded = false;
                            }
                            renderExclusionsList();
                        });
                    }
                };
                item.appendChild(btn);
                exclusionsContainer.appendChild(item);
            });
        });
    }
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function dataUrlToFile(dataUrl, fileName, fileType) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], fileName || 'file', {
        type: fileType || blob.type || 'image/jpeg',
        lastModified: Date.now()
    });
}

// ─── Offscreen compression pipeline ────────────────────────────────────────
// Map of requestId → { resolve, originalFile, quality, targetFormat, onProgress }
const _compressionJobs = new Map();

// Global listener: routes progress/complete/error back to the waiting promise
chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.requestId) return;
    const job = _compressionJobs.get(msg.requestId);
    if (!job) return;

    if (msg.type === 'COMPRESSION_PROGRESS') {
        if (job.onProgress) job.onProgress(msg.progress);
    } else if (msg.type === 'COMPRESSION_COMPLETE') {
        _compressionJobs.delete(msg.requestId);
        if (msg.dataUrl) {
            dataUrlToFile(msg.dataUrl, msg.fileName, msg.fileType)
                .then(job.resolve)
                .catch(err => {
                    console.warn('[UpForge] Error converting COMPRESSION_COMPLETE dataUrl:', err);
                    fallbackClientSideCompress(job.originalFile, job.quality, job.targetFormat).then(job.resolve);
                });
        } else if (msg.fileData) {
            let buf = msg.fileData;
            if (buf && !(buf instanceof ArrayBuffer)) {
                if (ArrayBuffer.isView(buf)) {
                    buf = buf.buffer;
                } else if (typeof buf === 'object') {
                    const len = Object.keys(buf).length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = buf[i];
                    buf = bytes.buffer;
                }
            }
            const file = new File([buf], msg.fileName || 'compressed_file', {
                type: msg.fileType || 'image/jpeg',
                lastModified: Date.now()
            });
            job.resolve(file);
        } else {
            fallbackClientSideCompress(job.originalFile, job.quality, job.targetFormat).then(job.resolve);
        }
    } else if (msg.type === 'COMPRESSION_ERROR') {
        _compressionJobs.delete(msg.requestId);
        console.warn('[UpForge] Offscreen compression error:', msg.error);
        fallbackClientSideCompress(job.originalFile, job.quality, job.targetFormat).then(job.resolve);
    }
});

function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) {
        return file.type !== 'image/svg+xml';
    }
    const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'jfif'].includes(ext);
}

async function fallbackClientSideCompress(file, quality, targetFormat) {
    try {
        console.log('[UpForge] Using client-side canvas fallback compression...');
        const bitmap = await createImageBitmap(file);
        let width = bitmap.width;
        let height = bitmap.height;
        const maxWidth = 1920;

        if (width > maxWidth) {
            const ratio = maxWidth / width;
            width = maxWidth;
            height = height * ratio;
        }

        const canvasWidth = Math.max(1, Math.round(width));
        const canvasHeight = Math.max(1, Math.round(height));

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);
        bitmap.close();

        let type = (targetFormat && targetFormat !== 'auto') ? targetFormat : (file.type || 'image/jpeg');
        if (type === 'image/png' && (!targetFormat || targetFormat === 'auto')) {
            type = 'image/jpeg';
        }

        const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
        if (!blob) return file;

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

        return new File([blob], outName, { type: type, lastModified: Date.now() });
    } catch (e) {
        console.error('[UpForge] Client fallback error:', e);
        return file;
    }
}

/**
 * Send a file to the offscreen ImageCompressor and get back the compressed File.
 * Handles Extension Context Invalidated (extension reloaded in chrome://extensions) via client fallback.
 */
async function compressViaOffscreen(file, quality, targetFormat, engine, onProgress) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        console.warn('[UpForge] Extension context invalidated. Using client fallback compression.');
        return fallbackClientSideCompress(file, quality, targetFormat);
    }

    const requestId = `upforge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let fileData;
    try {
        fileData = await fileToDataUrl(file);
    } catch (e) {
        fileData = await file.arrayBuffer();
    }

    let fileType = file.type;
    if (!fileType || fileType.trim() === '') {
        const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
        fileType = mimeMap[ext] || 'image/jpeg';
    }

    return new Promise((resolve) => {
        _compressionJobs.set(requestId, {
            resolve,
            originalFile: file,
            quality,
            targetFormat,
            onProgress
        });

        try {
            chrome.runtime.sendMessage({
                type: 'COMPRESS_FILE',
                requestId,
                fileData,
                fileName: file.name,
                fileType: fileType,
                options: {
                    quality,
                    maxWidth: 1920,
                    mimeType: fileType,
                    targetFormat: targetFormat || 'image/webp',
                    engine: engine || 'wasm'
                }
            }, (ack) => {
                if (chrome.runtime?.lastError) {
                    _compressionJobs.delete(requestId);
                    console.warn('[UpForge] Background unreachable:', chrome.runtime.lastError.message);
                    fallbackClientSideCompress(file, quality, targetFormat).then(resolve);
                }
            });
        } catch (err) {
            _compressionJobs.delete(requestId);
            console.warn('[UpForge] sendMessage context invalidated error:', err.message);
            fallbackClientSideCompress(file, quality, targetFormat).then(resolve);
        }

        // Safety timeout – 60 s
        setTimeout(() => {
            if (_compressionJobs.has(requestId)) {
                _compressionJobs.delete(requestId);
                console.warn('[UpForge] Compression timed out, using client fallback.');
                fallbackClientSideCompress(file, quality, targetFormat).then(resolve);
            }
        }, 60_000);
    });
}

// Updated handleFiles to use the new modal UI
function handleFiles(files, callback) {
    console.log('[UpForge] handleFiles called. Files count:', files.length, 'isDomainExcluded:', isDomainExcluded);
    // Do not process if domain excluded or no files
    if (isDomainExcluded || files.length === 0) {
        console.log('[UpForge] Bypassing modal interception (excluded domain or no files).');
        return callback(files);
    }

    // Ensure modal is initialized
    initModal();

    // Save references for modal callbacks
    originalFiles = files;
    currentFile = files[0];

    // Populate header & metadata card
    shadowRoot.getElementById('file-name').textContent = currentFile.name;
    const ext = (currentFile.name.split('.').pop() || 'FILE').toUpperCase();
    shadowRoot.getElementById('file-ext').textContent = ext;

    const sizeMB = (currentFile.size / (1024 * 1024)).toFixed(2);
    const sizeKB = (currentFile.size / 1024).toFixed(1);
    const formattedSize = currentFile.size >= 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
    
    const mimeLabel = currentFile.type ? (currentFile.type.split('/')[1] || currentFile.type).toUpperCase() : ext;
    const metaDetailsEl = shadowRoot.getElementById('file-meta-details');
    if (metaDetailsEl) {
        metaDetailsEl.textContent = `${mimeLabel} File • ${formattedSize}`;
    }

    const statOriginalEl = shadowRoot.getElementById('stat-original-size');
    if (statOriginalEl) {
        statOriginalEl.textContent = formattedSize;
    }

    // Render preview
    const preview = shadowRoot.getElementById('preview-area');
    preview.innerHTML = '';
    if (currentFile.type.startsWith('image/') && ext.toLowerCase() !== 'svg') {
        const url = URL.createObjectURL(currentFile);
        const img = document.createElement('img');
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        preview.appendChild(img);
    } else {
        const div = document.createElement('div');
        div.className = 'preview-fallback';
        div.innerHTML = `
            <div class="preview-icon">📄</div>
            <div style="font-weight: 600; color: var(--text-color);">${currentFile.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${formattedSize}</div>
        `;
        preview.appendChild(div);
    }

    // Quality slider & Format & Engine estimation
    const range = shadowRoot.getElementById('quality-range');
    const formatSelect = shadowRoot.getElementById('format-select');
    const leftLabel = shadowRoot.getElementById('range-label-left');
    const rightLabel = shadowRoot.getElementById('range-label-right');
    
    function updateEstimation() {
        const quality = parseInt(range.value, 10) / 100;
        if (leftLabel) leftLabel.textContent = `${range.value}%`;
        
        const targetFormat = formatSelect ? formatSelect.value : 'image/webp';
        const engineVal = shadowRoot.querySelector('input[name="upforge-engine"]:checked')?.value || 'wasm';

        let formatMultiplier = quality * 0.65;
        let formatName = 'WebP';

        if (targetFormat === 'image/jpeg') {
            formatMultiplier = quality * 0.85;
            formatName = 'JPEG';
        } else if (targetFormat === 'image/avif') {
            formatMultiplier = quality * 0.45;
            formatName = 'AVIF';
        } else if (targetFormat === 'image/png') {
            formatMultiplier = 0.75;
            formatName = 'PNG';
        } else if (targetFormat === 'auto') {
            formatName = (currentFile.type ? currentFile.type.split('/')[1] : ext).toUpperCase();
        }

        const estimatedBytes = currentFile.size * formatMultiplier;
        const estMB = (estimatedBytes / (1024 * 1024)).toFixed(2);
        const estKB = (estimatedBytes / 1024).toFixed(1);
        const formattedEst = estimatedBytes >= 1024 * 1024 ? `~${estMB} MB` : `~${estKB} KB`;
        const pctSaved = Math.max(0, Math.round((1 - (estimatedBytes / currentFile.size)) * 100));

        const engineName = engineVal === 'wasm' ? 'WASM' : 'Canvas';

        if (rightLabel) {
            rightLabel.textContent = `${formattedEst} (${formatName} • ${engineName} • ${pctSaved}% saved)`;
        }
    }
    range.addEventListener('input', updateEstimation);
    if (formatSelect) formatSelect.addEventListener('change', updateEstimation);
    shadowRoot.querySelectorAll('input[name="upforge-engine"]').forEach(radio => {
        radio.addEventListener('change', updateEstimation);
    });
    updateEstimation();

    // Button actions
    shadowRoot.getElementById('btn-keep').onclick = () => {
        console.log('[UpForge] Keep Original clicked.');
        overlay.classList.add('hidden');
        modalContainer.style.pointerEvents = 'none';
        callback(originalFiles);
    };
    shadowRoot.getElementById('exclude-site').onclick = () => {
        console.log('[UpForge] Exclude site clicked.');
        try {
            chrome.storage.sync.get(['excludedDomains'], (res) => {
                const doms = (res && res.excludedDomains) || [];
                if (!doms.includes(window.location.hostname)) {
                    doms.push(window.location.hostname);
                    chrome.storage.sync.set({ excludedDomains: doms }, () => {
                        console.log('[UpForge] Successfully excluded current domain:', window.location.hostname);
                        console.log('[UpForge] To reset, run in console: chrome.storage.sync.set({ excludedDomains: [] })');
                    });
                    isDomainExcluded = true;
                }
            });
        } catch (err) {
            console.error('[UpForge] Error during domain exclusion:', err);
        }
        overlay.classList.add('hidden');
        modalContainer.style.pointerEvents = 'none';
        callback(originalFiles);
    };
    // Compress button — driven by real ImageCompressor.js progress events
    shadowRoot.getElementById('btn-compress').onclick = async () => {
        console.log('[UpForge] Compress & Upload clicked.');
        const quality = parseInt(range.value, 10) / 100;
        const targetFormat = formatSelect ? formatSelect.value : 'image/webp';
        const selectedEngine = shadowRoot.querySelector('input[name="upforge-engine"]:checked')?.value || 'wasm';

        // ── Switch to progress view ──────────────────────────────────────────
        const mainView     = shadowRoot.getElementById('main-view');
        const progressView = shadowRoot.getElementById('progress-view');
        const progressPct  = shadowRoot.getElementById('progress-pct');
        const progressFill = shadowRoot.getElementById('progress-fill');
        const progressLabel = shadowRoot.getElementById('progress-label');
        const progressSub   = shadowRoot.getElementById('progress-sub');

        mainView.classList.add('hidden');
        progressView.classList.remove('hidden');
        modalContainer.style.pointerEvents = 'auto';

        // Smooth-animate the bar to an exact percentage
        function setProgress(pct, label, sub) {
            const rounded = Math.round(pct * 100);
            progressPct.textContent  = `${rounded}%`;
            progressFill.style.width = `${rounded}%`;
            if (label) progressLabel.textContent = label;
            if (sub)   progressSub.textContent   = sub;
        }

        setProgress(0, 'Preparing file…', 'Reading file data for the compressor.');

        const processedFiles = [];

        for (let i = 0; i < files.length; i++) {
            const file       = files[i];
            const fileLabel  = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
            const isImage    = isImageFile(file);

            if (!isImage) {
                // Non-image: passthrough with instant progress
                setProgress(1, 'Skipping…', `${file.name} — no compression needed.`);
                processedFiles.push(file);
                continue;
            }

            // Each file occupies an equal slice of 0–100%
            const sliceStart = i / files.length;
            const sliceEnd   = (i + 1) / files.length;

            let compressed;
            try {
                compressed = await compressViaOffscreen(file, quality, targetFormat, selectedEngine, (rawProgress) => {
                    const overall = sliceStart + rawProgress * (sliceEnd - sliceStart);

                    let label, sub;
                    if (rawProgress < 0.2) {
                        label = `Loading image${fileLabel}…`;
                        sub   = `Decoding ${file.name}`;
                    } else if (rawProgress < 0.6) {
                        label = `Compressing (${selectedEngine.toUpperCase()})${fileLabel}…`;
                        sub   = `Encoding to ${targetFormat.replace('image/', '').toUpperCase()} at ${range.value}% quality`;
                    } else if (rawProgress < 1.0) {
                        label = `Finalising data${fileLabel}…`;
                        sub   = `Writing output blob`;
                    } else {
                        label = `Done${fileLabel}!`;
                        sub   = `Compressed to output image`;
                    }
                    setProgress(overall, label, sub);
                });
            } catch (err) {
                console.error('[UpForge] Compression failed, falling back to original:', err);
                compressed = file;
            }

            if (!compressed || !(compressed instanceof File)) {
                console.warn('[UpForge] Result is not a valid File, falling back to original file:', compressed);
                compressed = file;
            }

            processedFiles.push(compressed);
            const compSizeText = compressed && compressed.size ? `${(compressed.size / 1024).toFixed(1)} KB` : 'Ready';
            setProgress(sliceEnd,
                `File ${i + 1} ready${files.length > 1 ? ` of ${files.length}` : ''}`,
                `${file.name} → ${compSizeText}`);
        }

        // ── Final state ───────────────────────────────────────────────────────
        setProgress(1, 'Done! Uploading…', 'Handing compressed file to the site.');
        await new Promise(r => setTimeout(r, 600));

        overlay.classList.add('hidden');
        modalContainer.style.pointerEvents = 'none';

        // Reset for next time
        progressView.classList.add('hidden');
        mainView.classList.remove('hidden');
        setProgress(0, 'Preparing file…', '');

        callback(processedFiles);
    };

    // Show modal and activate click events on the container
    console.log('[UpForge] Displaying modal.');
    overlay.classList.remove('hidden');
    modalContainer.style.pointerEvents = 'auto';
}

// 3. Domain Exclusion Check
try {
    chrome.storage.sync.get(['excludedDomains'], (result) => {
        const domains = (result && result.excludedDomains) || [];
        console.log('[UpForge] Excluded domains list:', domains);
        if (domains.includes(window.location.hostname)) {
            isDomainExcluded = true;
            console.log('[UpForge] Current domain is excluded from interception.');
        }
    });
} catch (err) {
    console.error('[UpForge] Failed to run domain exclusion check:', err);
}

// Example interception for file inputs
document.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'file' && !e.__extensionProcessed) {
        if (e.target.files && e.target.files.length > 0) {
            console.log('[UpForge] Change event intercepted on file input:', e.target);
            e.preventDefault();
            e.stopImmediatePropagation();

            const originalFiles = Array.from(e.target.files);
            handleFiles(originalFiles, (newFiles) => {
                try {
                    const dt = new DataTransfer();
                    (newFiles || []).forEach(f => {
                        if (f && f instanceof File) {
                            dt.items.add(f);
                        } else if (f && f instanceof Blob) {
                            dt.items.add(new File([f], f.name || 'file', { type: f.type || 'application/octet-stream' }));
                        } else {
                            console.warn('[UpForge] Skipping non-File item in DataTransfer:', f);
                        }
                    });
                    e.target.files = dt.files;
                } catch (dtErr) {
                    console.error('[UpForge] DataTransfer assignment error:', dtErr);
                }

                // Re-dispatch event
                const newEvent = new Event('change', { bubbles: true });
                newEvent.__extensionProcessed = true;
                e.target.dispatchEvent(newEvent);
                console.log('[UpForge] Re-dispatched processed change event.');
            });
        }
    }
}, true); // Use capture phase
