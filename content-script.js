// content-script.js

// 1. Inject main-world.js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('main-world.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// ─── Image Types & Broadening Helpers ─────────────────────────────────────────
const IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff',
    'heic', 'heif', 'jfif', 'ico', 'pjpeg', 'pjp', 'svg'
]);

const BROADENED_IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,.heic,.heif,.jfif,.ico,image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/tiff,image/heic,image/heif';

const EXT_TO_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', pjp: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    heic: 'image/heic', heif: 'image/heif', ico: 'image/x-icon', svg: 'image/svg+xml'
};

/**
 * Determines whether an `accept` attribute string is strictly targeting images.
 * Returns false if it contains non-image types (e.g. .pdf, application/pdf, .docx, 
 */
function isImageAcceptString(accept) {
    if (!accept || typeof accept !== 'string') return false;
    const trimmed = accept.trim();
    if (!trimmed || trimmed === '*' || trimmed === '*/*') return false;

    const tokens = trimmed.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return false;

    for (const token of tokens) {
        if (token.startsWith('image/')) continue;
        if (token.startsWith('.')) {
            const ext = token.slice(1);
            if (IMAGE_EXTENSIONS.has(ext)) continue;
            return false; // Non-image extension e.g. .pdf, .docx, .zip
        }
        return false; // Non-image MIME or token
    }
    return true;
}

/**
 * Parses the original `accept` attribute to determine which output formats the destination website permits.
 */
function parseWebsiteAcceptedFormats(accept) {
    const defaultAll = {
        isRestricted: false,
        formats: ['image/webp', 'image/avif', 'image/jpeg', 'image/png'],
        displayNames: ['WebP', 'AVIF', 'JPEG', 'PNG']
    };

    if (!accept || typeof accept !== 'string') return defaultAll;
    const trimmed = accept.trim();
    if (!trimmed || trimmed === '*' || trimmed === '*/*') return defaultAll;

    const tokens = trimmed.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0 || tokens.includes('image/*')) return defaultAll;

    const directFormats = [];
    const displayNames = [];

    const hasJpeg = tokens.some(t => t === 'image/jpeg' || t === 'image/jpg' || t === 'image/pjpeg' || t === '.jpg' || t === '.jpeg' || t === '.jfif' || t === '.pjpeg' || t === '.pjp');
    const hasPng = tokens.some(t => t === 'image/png' || t === 'image/x-png' || t === '.png');
    const hasWebp = tokens.some(t => t === 'image/webp' || t === '.webp');
    const hasAvif = tokens.some(t => t === 'image/avif' || t === '.avif');
    const hasGif = tokens.some(t => t === 'image/gif' || t === '.gif');
    const hasBmp = tokens.some(t => t === 'image/bmp' || t === '.bmp');

    if (hasWebp) { directFormats.push('image/webp'); displayNames.push('WebP'); }
    if (hasAvif) { directFormats.push('image/avif'); displayNames.push('AVIF'); }
    if (hasJpeg) { directFormats.push('image/jpeg'); displayNames.push('JPEG'); }
    if (hasPng) { directFormats.push('image/png'); displayNames.push('PNG'); }

    if (directFormats.length === 0 && (hasGif || hasBmp)) {
        directFormats.push('image/png', 'image/jpeg');
        displayNames.push('PNG', 'JPEG');
    }

    if (directFormats.length === 0) {
        return defaultAll;
    }

    return {
        isRestricted: true,
        formats: directFormats,
        displayNames: displayNames,
        tokens
    };
}

const inputOriginalAcceptMap = new WeakMap();

function getOriginalAccept(input) {
    if (!input) return '';
    if (inputOriginalAcceptMap.has(input)) {
        return inputOriginalAcceptMap.get(input);
    }
    if (input.dataset && input.dataset.urforgeOrigAccept !== undefined) {
        return input.dataset.urforgeOrigAccept;
    }
    return input.getAttribute('accept') || '';
}

function broadenFileInput(input) {
    if (!input || input.type !== 'file') return;
    const currentAccept = input.getAttribute('accept');
    if (!currentAccept || currentAccept === BROADENED_IMAGE_ACCEPT) return;

    if (isImageAcceptString(currentAccept)) {
        inputOriginalAcceptMap.set(input, currentAccept);
        if (input.dataset) {
            input.dataset.urforgeOrigAccept = currentAccept;
        }
        input.setAttribute('accept', BROADENED_IMAGE_ACCEPT);
        console.log('[urforge] Broadened accept for image input. Original:', currentAccept);
    }
}

// 2. Setup Shadow DOM Modal
// Global placeholders used by modal callbacks
let originalFiles = [];
let currentFile = null;
let modalContainer, shadowRoot, overlay;
let isDomainExcluded = false;
let configuredEngine = 'wasm';

try {
    chrome.storage.sync.get(['defaultEngine'], (res) => {
        if (res && res.defaultEngine) {
            configuredEngine = res.defaultEngine;
        }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.defaultEngine) {
            configuredEngine = changes.defaultEngine.newValue || 'wasm';
        }
    });
} catch (e) {
    console.warn('[urforge] Storage sync listener initialization error:', e);
}

// ─── Dialog-based Modal Show/Hide Helpers ───────────────────────────────────
// Using <dialog>.showModal() places our UI in the browser's top layer,
// which renders above ALL other content including website showModal() dialogs.
function showUrforgeModal() {
    if (!modalContainer || !overlay) return;
    overlay.classList.remove('hidden');
    if (!modalContainer.open) {
        try {
            modalContainer.showModal();
        } catch (e) {
            // Fallback if showModal fails (e.g. already open)
            console.warn('[urforge] showModal fallback:', e);
            modalContainer.setAttribute('open', '');
        }
    }
}

function hideUrforgeModal() {
    if (!modalContainer || !overlay) return;
    overlay.classList.add('hidden');
    if (modalContainer.open) {
        try {
            modalContainer.close();
        } catch (e) {
            console.warn('[urforge] close fallback:', e);
            modalContainer.removeAttribute('open');
        }
    }
}

// Updated initModal with UI components and event handling
function initModal() {
    if (modalContainer) return;

    // Create container using <dialog> so it enters the browser's top layer
    // This guarantees our UI renders above ALL website content, including
    // their own showModal() dialogs (e.g. Google NotebookLM upload popup).
    modalContainer = document.createElement('dialog');
    Object.assign(modalContainer.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        maxWidth: '100vw',
        maxHeight: '100vh',
        padding: '0',
        margin: '0',
        border: 'none',
        background: 'transparent',
        zIndex: '2147483647',
        overflow: 'hidden'
    });
    // Suppress the default ::backdrop of the <dialog> since we draw our own overlay
    const dialogStyleTag = document.createElement('style');
    dialogStyleTag.textContent = `dialog[data-urforge-dialog]::backdrop { background: transparent !important; }`;
    document.head.appendChild(dialogStyleTag);
    modalContainer.setAttribute('data-urforge-dialog', '');
    (document.body || document.documentElement).appendChild(modalContainer);

    // Handle Escape key: <dialog> natively fires 'cancel' on Esc — sync our overlay state
    modalContainer.addEventListener('cancel', (e) => {
        e.preventDefault(); // prevent native close, we manage it ourselves
        hideUrforgeModal();
    });

    // <dialog> doesn't support attachShadow, so nest a <div> inside it
    const shadowHost = document.createElement('div');
    Object.assign(shadowHost.style, {
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'auto'
    });
    modalContainer.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    // Styles
    const style = document.createElement('style');
    style.textContent = `
        :host {
            all: initial;
            --bg-color: #161618;
            --surface-color: #1c1c1e;
            --surface-card: #2c2c2e;
            --surface-hover: #3a3a3c;
            --primary-color: #0071e3;
            --primary-hover: #0077ed;
            --accent-color: #2997ff;
            --text-color: #f5f5f7;
            --text-muted: #86868b;
            --border-color: rgba(255, 255, 255, 0.08);
            --border-radius: 14px;
            --overlay-bg: rgba(0, 0, 0, 0.65);
            --danger-color: #ff453a;
            --secondary-bg: rgba(255, 255, 255, 0.08);
            --secondary-hover: rgba(255, 255, 255, 0.12);
        }
        .overlay {
            position: fixed;
            inset: 0;
            background: var(--overlay-bg);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
            padding: 1.25rem;
            box-sizing: border-box;
            -webkit-font-smoothing: antialiased;
            z-index: 2147483648; /* ensure overlay is above all site elements */
        }
        .modal {
            background: var(--surface-color);
            color: var(--text-color);
            width: 740px;
            max-width: 95vw;
            border-radius: var(--border-radius);
            overflow: hidden;
            box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border-color);
            display: flex;
            flex-direction: column;
            position: relative;
            transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .modal.modal-pdf {
            width: 960px;
            max-width: 96vw;
        }

        .modal.modal-pdf .split-container {
            min-height: 560px;
            height: 75vh;
            max-height: 750px;
        }

        .modal.modal-pdf .left-panel {
            flex: 1.65;
        }

        .modal.modal-pdf .right-panel {
            flex: 0.85;
        }

        .modal.modal-pdf .preview-box {
            min-height: 440px;
            height: 100%;
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
            background: #0d0d0f;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
            border: 1px solid var(--border-color);
        }
        .preview-box img, .preview-box canvas {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        .preview-box iframe, .preview-box embed, .preview-box object {
            width: 100%;
            height: 100%;
            border: none;
            border-radius: 10px;
        }
        .preview-fallback {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.85rem;
            color: var(--text-muted);
            text-align: center;
            padding: 1.5rem;
        }
        .file-meta-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--surface-card);
            padding: 0.75rem 1rem;
            border-radius: 10px;
            border: 1px solid var(--border-color);
        }
        .file-info-main {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            overflow: hidden;
        }
        .file-name-text {
            font-weight: 500;
            font-size: 0.875rem;
            color: var(--text-color);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            letter-spacing: -0.01em;
        }
        .file-sub-text {
            font-size: 0.75rem;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        .badge {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-muted);
            padding: 0.2rem 0.45rem;
            border-radius: 5px;
            font-size: 0.68rem;
            font-weight: 600;
            letter-spacing: 0.04em;
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
            font-size: 0.95rem;
            letter-spacing: -0.01em;
            color: var(--text-color);
        }
        .close-btn {
            cursor: pointer;
            color: var(--text-muted);
            transition: color 0.15s ease;
            line-height: 1;
            padding: 0.25rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }
        .close-btn:hover {
            color: var(--text-color);
        }
        
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .control-label {
            font-size: 0.8rem;
            font-weight: 500;
            color: var(--text-muted);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .slider-container {
            padding: 0.25rem 0;
        }
        .slider-container input[type=range] {
            width: 100%;
            -webkit-appearance: none;
            appearance: none;
            height: 4px;
            background: #38383a;
            border-radius: 2px;
            outline: none;
            margin: 8px 0;
        }
        .slider-container input[type=range]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #ffffff;
            cursor: pointer;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
            transition: transform 0.15s ease;
        }
        .slider-container input[type=range]::-webkit-slider-thumb:hover {
            transform: scale(1.15);
        }
        
        .size-stats-card {
            background: var(--surface-card);
            padding: 0.75rem 0.9rem;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            font-size: 0.8rem;
        }
        .stat-row {
            display: flex;
            justify-content: space-between;
            color: var(--text-muted);
        }
        .stat-val-highlight {
            color: var(--accent-color);
            font-weight: 500;
        }

        .control-select {
            width: 100%;
            background: var(--surface-card);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.55rem 0.75rem;
            font-size: 0.825rem;
            outline: none;
            cursor: pointer;
            transition: border-color 0.15s;
            font-family: inherit;
        }
        .control-select:focus {
            border-color: var(--primary-color);
        }

        .action-stack {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .btn {
            padding: 0.625rem 1rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.825rem;
            font-weight: 500;
            font-family: inherit;
            transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
            outline: none;
            display: flex;
            align-items: center;
            justify-content: center;
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
        }
        .btn-secondary:hover {
            background: var(--secondary-hover);
        }
        .btn-danger {
            background: transparent;
            color: var(--danger-color);
            font-size: 0.78rem;
            padding: 0.4rem;
        }
        .btn-danger:hover {
            opacity: 0.8;
        }

        .hidden {
            display: none !important;
        }
        .manage-link {
            color: var(--text-muted);
            cursor: pointer;
            font-size: 0.72rem;
            text-align: center;
            transition: color 0.15s;
        }
        .manage-link:hover {
            color: var(--text-color);
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
            background: var(--surface-card);
            padding: 0.6rem 0.85rem;
            border-radius: 8px;
            font-size: 0.825rem;
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
            font-size: 0.78rem;
            font-weight: 500;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            transition: opacity 0.15s;
        }
        .btn-remove-exclusion:hover {
            opacity: 0.8;
        }

        /* Progress View */
        #progress-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1rem;
            padding: 3.5rem 2rem;
            min-height: 380px;
        }
        .progress-spinner {
            width: 36px;
            height: 36px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top-color: var(--primary-color);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .progress-label {
            font-size: 0.95rem;
            font-weight: 500;
            color: var(--text-color);
            text-align: center;
            letter-spacing: -0.01em;
        }
        .progress-sub {
            font-size: 0.78rem;
            color: var(--text-muted);
            text-align: center;
            margin-top: -0.5rem;
        }
        .progress-track {
            width: 100%;
            max-width: 320px;
            height: 4px;
            background: #2c2c2e;
            border-radius: 99px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--primary-color);
            border-radius: 99px;
            width: 0%;
            transition: width 0.3s ease;
        }
        .progress-pct {
            font-size: 2rem;
            font-weight: 600;
            color: var(--text-color);
            letter-spacing: -0.03em;
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
                                <span>Optimization</span>
                                <span class="close-btn" id="close-modal">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"></line><line x1="11" y1="1" x2="1" y2="11"></line></svg>
                                </span>
                            </div>
                            
                            <div id="image-controls">
                                <div class="control-group" style="margin-top: 1rem;">
                                    <div class="control-label" id="format-label-row">
                                        <span>Output Format</span>
                                        <span id="site-format-hint" style="font-size:0.75rem; color:var(--accent-color); font-weight:500;"></span>
                                    </div>
                                    <select id="format-select" class="control-select">
                                        <option value="image/webp" selected>WebP (Recommended)</option>
                                        <option value="image/avif">AVIF (Smallest)</option>
                                        <option value="image/jpeg">JPEG (Universal)</option>
                                        <option value="image/png">PNG</option>
                                        <option value="auto">Same as Original</option>
                                    </select>
                                </div>

                                <div class="control-group" id="quality-control-group" style="margin-top: 0.85rem; transition: opacity 0.2s ease;">
                                    <div class="control-label">
                                        <span>Quality Level</span>
                                        <span id="range-label-left">75%</span>
                                    </div>
                                    <div class="slider-container">
                                        <input type="range" id="quality-range" min="1" max="100" step="1" value="75">
                                    </div>
                                </div>

                                <div class="size-stats-card" style="margin-top: 1rem;">
                                    <div class="stat-row">
                                        <span>Original</span>
                                        <span id="stat-original-size">0 MB</span>
                                    </div>
                                    <div class="stat-row">
                                        <span>Estimated</span>
                                        <span class="stat-val-highlight" id="range-label-right">~0 MB</span>
                                    </div>
                                </div>
                            </div>

                            <div id="non-image-notice" class="size-stats-card hidden" style="margin-top: 1.25rem;">
                                <div class="stat-row" style="color: var(--text-color); font-weight: 500;">
                                    <span>Document File</span>
                                </div>
                                <div style="color: var(--text-muted); font-size: 0.78rem; line-height: 1.4; margin-top: 0.25rem;">
                                    This file format will be uploaded directly in its original format without conversion.
                                </div>
                            </div>
                        </div>

                        <div class="action-stack">
                            <button class="btn btn-primary" id="btn-compress">
                                Compress & Upload
                            </button>
                            <button class="btn btn-secondary" id="btn-keep">
                                Upload Original
                            </button>
                            <button class="btn btn-danger" id="exclude-site">
                                Never ask on this site
                            </button>
                            <span class="manage-link" id="btn-manage-exclusions">Manage Excluded Sites</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Exclusions List View -->
            <div id="exclusions-view" class="hidden">
                <div class="panel-header">
                    <span>Excluded Sites</span>
                    <span class="close-btn" id="btn-back-to-main">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"></line><line x1="11" y1="1" x2="1" y2="11"></line></svg>
                    </span>
                </div>
                <div id="exclusions-list-container">
                    <!-- Dynamic list of domains -->
                </div>
            </div>

            <!-- Progress View -->
            <div id="progress-view" class="hidden">
                <div class="progress-spinner"></div>
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
        console.log('[urforge] Close button clicked.');
        hideUrforgeModal();
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
                            console.log('[urforge] Removed domain from exclusions:', dom);
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
                    console.warn('[urforge] Error converting COMPRESSION_COMPLETE dataUrl:', err);
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
        console.warn('[urforge] Offscreen compression error:', msg.error);
        fallbackClientSideCompress(job.originalFile, job.quality, job.targetFormat).then(job.resolve);
    }
});

function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) {
        return file.type !== 'image/svg+xml';
    }
    const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'jfif', 'avif', 'heic', 'heif', 'tiff', 'tif', 'ico', 'pjpeg', 'pjp'].includes(ext);
}

async function fallbackClientSideCompress(file, quality, targetFormat) {
    try {
        console.log('[urforge] Using client-side canvas fallback compression...');
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

        if (type === 'image/png' && quality < 0.98) {
            const imgData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imgData.data;
            const len = data.length;
            const levels = Math.max(4, Math.min(256, Math.round(256 * Math.pow(quality, 0.75))));
            const step = 255 / (levels - 1);
            for (let i = 0; i < len; i += 4) {
                data[i] = Math.round(Math.round(data[i] / step) * step);
                data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
                data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
                if (data[i + 3] < 255 && data[i + 3] > 0) {
                    data[i + 3] = Math.round(Math.round(data[i + 3] / step) * step);
                }
            }
            ctx.putImageData(imgData, 0, 0);
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
        console.error('[urforge] Client fallback error:', e);
        return file;
    }
}

/**
 * Send a file to the offscreen ImageCompressor and get back the compressed File.
 * Handles Extension Context Invalidated (extension reloaded in chrome://extensions) via client fallback.
 */
async function compressViaOffscreen(file, quality, targetFormat, engine, onProgress) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        console.warn('[urforge] Extension context invalidated. Using client fallback compression.');
        return fallbackClientSideCompress(file, quality, targetFormat);
    }

    const requestId = `urforge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let fileData;
    try {
        fileData = await fileToDataUrl(file);
    } catch (e) {
        fileData = await file.arrayBuffer();
    }

    let fileType = file.type;
    if (!fileType || fileType.trim() === '') {
        const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
        fileType = EXT_TO_MIME[ext] || 'image/jpeg';
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
                    console.warn('[urforge] Background unreachable:', chrome.runtime.lastError.message);
                    fallbackClientSideCompress(file, quality, targetFormat).then(resolve);
                }
            });
        } catch (err) {
            _compressionJobs.delete(requestId);
            console.warn('[urforge] sendMessage context invalidated error:', err.message);
            fallbackClientSideCompress(file, quality, targetFormat).then(resolve);
        }

        // Safety timeout – 60 s
        setTimeout(() => {
            if (_compressionJobs.has(requestId)) {
                _compressionJobs.delete(requestId);
                console.warn('[urforge] Compression timed out, using client fallback.');
                fallbackClientSideCompress(file, quality, targetFormat).then(resolve);
            }
        }, 60_000);
    });
}

// Updated handleFiles to use the new modal UI with website format restrictions
function handleFiles(files, callback, sourceInput) {
    console.log('[urforge] handleFiles called. Files count:', files.length, 'isDomainExcluded:', isDomainExcluded);
    // Do not process if domain excluded or no files
    if (isDomainExcluded || files.length === 0) {
        console.log('[urforge] Bypassing modal interception (excluded domain or no files).');
        return callback(files);
    }

    // Ensure modal is initialized
    initModal();

    // Save references for modal callbacks
    originalFiles = files;
    currentFile = files[0];

    // Determine website accepted formats from source input
    const origAccept = sourceInput ? getOriginalAccept(sourceInput) : '';
    const restrictionInfo = parseWebsiteAcceptedFormats(origAccept);

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

    // Render preview & configure controls based on file type
    const preview = shadowRoot.getElementById('preview-area');
    preview.innerHTML = '';
    const isCurrentImage = isImageFile(currentFile);

    const imageControlsEl = shadowRoot.getElementById('image-controls');
    const nonImageNoticeEl = shadowRoot.getElementById('non-image-notice');
    const btnCompressEl = shadowRoot.getElementById('btn-compress');
    const btnKeepEl = shadowRoot.getElementById('btn-keep');
    const modalEl = shadowRoot.getElementById('upload-modal');

    const isPdf = currentFile.type === 'application/pdf' || ext.toLowerCase() === 'pdf';
    if (modalEl) {
        if (isPdf) {
            modalEl.classList.add('modal-pdf');
        } else {
            modalEl.classList.remove('modal-pdf');
        }
    }

    if (!isCurrentImage) {
        // Non-image file (PDF, XLSX, etc.): hide all compression and format controls
        if (imageControlsEl) imageControlsEl.classList.add('hidden');
        if (nonImageNoticeEl) nonImageNoticeEl.classList.remove('hidden');
        if (btnCompressEl) btnCompressEl.classList.add('hidden');
        if (btnKeepEl) {
            btnKeepEl.classList.remove('hidden');
            btnKeepEl.className = 'btn btn-primary';
            btnKeepEl.textContent = 'Upload Original File';
        }
    } else {
        // Image file: show optimization controls and action buttons
        if (imageControlsEl) imageControlsEl.classList.remove('hidden');
        if (nonImageNoticeEl) nonImageNoticeEl.classList.add('hidden');
        if (btnCompressEl) {
            btnCompressEl.classList.remove('hidden');
            btnCompressEl.className = 'btn btn-primary';
            btnCompressEl.textContent = 'Compress & Upload';
        }
        if (btnKeepEl) {
            btnKeepEl.classList.remove('hidden');
            btnKeepEl.className = 'btn btn-secondary';
            btnKeepEl.textContent = 'Upload Original';
        }
    }

    if (currentFile.type.startsWith('image/') && ext.toLowerCase() !== 'svg') {
        const url = URL.createObjectURL(currentFile);
        const img = document.createElement('img');
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        preview.appendChild(img);
    } else if (currentFile.type === 'application/pdf' || ext.toLowerCase() === 'pdf') {
        const pdfBlob = currentFile.type === 'application/pdf' ? currentFile : new Blob([currentFile], { type: 'application/pdf' });
        const url = URL.createObjectURL(pdfBlob);

        const iframe = document.createElement('iframe');
        iframe.src = `${url}#toolbar=0&navpanes=0&view=FitH`;
        iframe.title = currentFile.name || 'PDF Preview';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '10px';
        iframe.style.backgroundColor = '#161618';

        preview.appendChild(iframe);
    } else {
        const div = document.createElement('div');
        div.className = 'preview-fallback';
        div.innerHTML = `
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#86868b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <div style="font-weight: 500; color: var(--text-color); font-size: 0.9rem;">${currentFile.name}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${formattedSize}</div>
        `;
        preview.appendChild(div);
    }

    // Configure Format Dropdown according to site restrictions
    const formatSelect = shadowRoot.getElementById('format-select');
    const siteHintEl = shadowRoot.getElementById('site-format-hint');
    formatSelect.innerHTML = '';

    const formatNameMap = {
        'image/webp': 'WebP (Recommended)',
        'image/avif': 'AVIF (Smallest)',
        'image/jpeg': 'JPEG (Universal)',
        'image/png': 'PNG (Optimized)',
        'image/png-lossless': 'PNG (Lossless)'
    };

    if (restrictionInfo.isRestricted) {
        if (siteHintEl) {
            siteHintEl.textContent = `Site requires: ${restrictionInfo.displayNames.join(', ')}`;
        }
        restrictionInfo.formats.forEach(fmt => {
            if (fmt === 'image/png') {
                const opt1 = document.createElement('option');
                opt1.value = 'image/png';
                opt1.textContent = 'PNG (Optimized)';
                formatSelect.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = 'image/png-lossless';
                opt2.textContent = 'PNG (Lossless)';
                formatSelect.appendChild(opt2);
            } else {
                const opt = document.createElement('option');
                opt.value = fmt;
                opt.textContent = formatNameMap[fmt] || fmt.split('/')[1].toUpperCase();
                formatSelect.appendChild(opt);
            }
        });

        // Smart default: if original extension is PNG and PNG is allowed, use PNG; else if WebP allowed -> WebP; else JPEG; else first allowed
        const origExt = (currentFile.name.split('.').pop() || '').toLowerCase();
        if (origExt === 'png' && restrictionInfo.formats.includes('image/png')) {
            formatSelect.value = 'image/png';
        } else if (restrictionInfo.formats.includes('image/webp')) {
            formatSelect.value = 'image/webp';
        } else if (restrictionInfo.formats.includes('image/jpeg')) {
            formatSelect.value = 'image/jpeg';
        } else if (restrictionInfo.formats.length > 0) {
            formatSelect.value = restrictionInfo.formats[0];
        }
    } else {
        if (siteHintEl) siteHintEl.textContent = '';
        formatSelect.innerHTML = `
            <option value="image/webp" selected>WebP (Recommended)</option>
            <option value="image/avif">AVIF (Smallest)</option>
            <option value="image/jpeg">JPEG (Universal)</option>
            <option value="image/png">PNG (Optimized)</option>
            <option value="image/png-lossless">PNG (Lossless)</option>
            <option value="auto">Same as Original</option>
        `;
    }

    // Quality slider & Format & Engine estimation
    const range = shadowRoot.getElementById('quality-range');
    const leftLabel = shadowRoot.getElementById('range-label-left');
    const rightLabel = shadowRoot.getElementById('range-label-right');

    function updateEstimation() {
        const quality = parseInt(range.value, 10) / 100;
        const targetFormat = formatSelect ? formatSelect.value : 'image/webp';
        const engineName = configuredEngine === 'wasm' ? 'WASM' : 'Canvas';
        const qualityGroup = shadowRoot.getElementById('quality-control-group');

        const isLossless = (targetFormat === 'image/png-lossless');

        if (isLossless) {
            range.disabled = true;
            if (qualityGroup) {
                qualityGroup.style.opacity = '0.35';
                qualityGroup.style.pointerEvents = 'none';
            }
            if (leftLabel) leftLabel.textContent = 'Lossless (Fixed)';
        } else {
            range.disabled = false;
            if (qualityGroup) {
                qualityGroup.style.opacity = '1';
                qualityGroup.style.pointerEvents = 'auto';
            }
            if (leftLabel) leftLabel.textContent = `${range.value}%`;
        }

        let formatMultiplier = quality * 0.65;
        let formatName = 'WebP';

        if (targetFormat === 'image/jpeg') {
            formatMultiplier = quality * 0.85;
            formatName = 'JPEG';
        } else if (targetFormat === 'image/avif') {
            formatMultiplier = quality * 0.45;
            formatName = 'AVIF';
        } else if (targetFormat === 'image/png') {
            formatMultiplier = 0.35 + (quality * 0.55);
            formatName = 'PNG';
        } else if (targetFormat === 'image/png-lossless') {
            formatMultiplier = 0.85;
            formatName = 'PNG Lossless';
        } else if (targetFormat === 'auto') {
            formatName = (currentFile.type ? currentFile.type.split('/')[1] : ext).toUpperCase();
        }

        const estimatedBytes = currentFile.size * formatMultiplier;
        const estMB = (estimatedBytes / (1024 * 1024)).toFixed(2);
        const estKB = (estimatedBytes / 1024).toFixed(1);
        const formattedEst = estimatedBytes >= 1024 * 1024 ? `~${estMB} MB` : `~${estKB} KB`;
        const pctSaved = Math.max(0, Math.round((1 - (estimatedBytes / currentFile.size)) * 100));

        if (rightLabel) {
            rightLabel.textContent = `${formattedEst} (${formatName} • ${engineName} • ${pctSaved}% saved)`;
        }
    }
    range.addEventListener('input', updateEstimation);
    if (formatSelect) formatSelect.addEventListener('change', updateEstimation);
    updateEstimation();

    // Button actions
    shadowRoot.getElementById('btn-keep').onclick = async () => {
        console.log('[urforge] Keep Original clicked.');
        hideUrforgeModal();

        // If the site restricts formats, ensure that incompatible formats (e.g. WebP/HEIC selected for JPEG-only site)
        // are converted to the site's required format so the upload succeeds.
        if (restrictionInfo.isRestricted && restrictionInfo.formats.length > 0) {
            const fallbackTargetFormat = restrictionInfo.formats[0];
            const processedFiles = [];
            for (const file of originalFiles) {
                const isImage = isImageFile(file);
                const fileExt = (file.name ? file.name.split('.').pop() : '').toLowerCase();
                const fileMime = file.type || EXT_TO_MIME[fileExt] || '';
                const isAccepted = restrictionInfo.formats.includes(fileMime);

                if (!isImage || isAccepted) {
                    processedFiles.push(file);
                } else {
                    try {
                        const converted = await compressViaOffscreen(file, 0.95, fallbackTargetFormat, 'wasm');
                        processedFiles.push(converted || file);
                    } catch (err) {
                        console.warn('[urforge] Error converting original file to site format:', err);
                        processedFiles.push(file);
                    }
                }
            }
            callback(processedFiles);
        } else {
            callback(originalFiles);
        }
    };

    shadowRoot.getElementById('exclude-site').onclick = () => {
        console.log('[urforge] Exclude site clicked.');
        try {
            chrome.storage.sync.get(['excludedDomains'], (res) => {
                const doms = (res && res.excludedDomains) || [];
                if (!doms.includes(window.location.hostname)) {
                    doms.push(window.location.hostname);
                    chrome.storage.sync.set({ excludedDomains: doms }, () => {
                        console.log('[urforge] Successfully excluded current domain:', window.location.hostname);
                        console.log('[urforge] To reset, run in console: chrome.storage.sync.set({ excludedDomains: [] })');
                    });
                    isDomainExcluded = true;
                }
            });
        } catch (err) {
            console.error('[urforge] Error during domain exclusion:', err);
        }
        hideUrforgeModal();
        callback(originalFiles);
    };

    // Compress button — driven by real ImageCompressor.js progress events
    shadowRoot.getElementById('btn-compress').onclick = async () => {
        console.log('[urforge] Compress & Upload clicked.');
        let quality = parseInt(range.value, 10) / 100;
        let targetFormat = formatSelect ? formatSelect.value : 'image/webp';
        const selectedEngine = configuredEngine || 'wasm';

        if (targetFormat === 'image/png-lossless') {
            targetFormat = 'image/png';
            quality = 1.0;
        }

        if (targetFormat === 'auto') {
            if (restrictionInfo.isRestricted && restrictionInfo.formats.length > 0) {
                targetFormat = restrictionInfo.formats[0];
            } else {
                targetFormat = currentFile.type || 'image/webp';
            }
        }

        // ── Switch to progress view ──────────────────────────────────────────
        const mainView = shadowRoot.getElementById('main-view');
        const progressView = shadowRoot.getElementById('progress-view');
        const progressPct = shadowRoot.getElementById('progress-pct');
        const progressFill = shadowRoot.getElementById('progress-fill');
        const progressLabel = shadowRoot.getElementById('progress-label');
        const progressSub = shadowRoot.getElementById('progress-sub');

        mainView.classList.add('hidden');
        progressView.classList.remove('hidden');
        // dialog is already open via showModal(), no need to re-show

        // Smooth-animate the bar to an exact percentage
        function setProgress(pct, label, sub) {
            const rounded = Math.round(pct * 100);
            progressPct.textContent = `${rounded}%`;
            progressFill.style.width = `${rounded}%`;
            if (label) progressLabel.textContent = label;
            if (sub) progressSub.textContent = sub;
        }

        setProgress(0, 'Preparing file…', 'Reading file data for the compressor.');

        const processedFiles = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileLabel = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
            const isImage = isImageFile(file);

            if (!isImage) {
                // Non-image: passthrough with instant progress
                setProgress(1, 'Skipping…', `${file.name} — no compression needed.`);
                processedFiles.push(file);
                continue;
            }

            // Each file occupies an equal slice of 0–100%
            const sliceStart = i / files.length;
            const sliceEnd = (i + 1) / files.length;

            let compressed;
            try {
                compressed = await compressViaOffscreen(file, quality, targetFormat, selectedEngine, (rawProgress) => {
                    const overall = sliceStart + rawProgress * (sliceEnd - sliceStart);

                    let label, sub;
                    if (rawProgress < 0.2) {
                        label = `Loading image${fileLabel}…`;
                        sub = `Decoding ${file.name}`;
                    } else if (rawProgress < 0.6) {
                        label = `Compressing (${selectedEngine.toUpperCase()})${fileLabel}…`;
                        sub = `Encoding to ${targetFormat.replace('image/', '').toUpperCase()} at ${range.value}% quality`;
                    } else if (rawProgress < 1.0) {
                        label = `Finalising data${fileLabel}…`;
                        sub = `Writing output blob`;
                    } else {
                        label = `Done${fileLabel}!`;
                        sub = `Compressed to output image`;
                    }
                    setProgress(overall, label, sub);
                });
            } catch (err) {
                console.error('[urforge] Compression failed, falling back to original:', err);
                compressed = file;
            }

            if (!compressed || !(compressed instanceof File)) {
                console.warn('[urforge] Result is not a valid File, falling back to original file:', compressed);
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

        hideUrforgeModal();

        // Reset for next time
        progressView.classList.add('hidden');
        mainView.classList.remove('hidden');
        setProgress(0, 'Preparing file…', '');

        callback(processedFiles);
    };

    // Show modal and activate click events on the container
    console.log('[urforge] Displaying modal.');
    showUrforgeModal();
}

// 3. Domain Exclusion Check
try {
    chrome.storage.sync.get(['excludedDomains'], (result) => {
        const domains = (result && result.excludedDomains) || [];
        console.log('[urforge] Excluded domains list:', domains);
        if (domains.includes(window.location.hostname)) {
            isDomainExcluded = true;
            console.log('[urforge] Current domain is excluded from interception.');
        }
    });
} catch (err) {
    console.error('[urforge] Failed to run domain exclusion check:', err);
}

// ─── Input Interception & Broadening Lifecycle ────────────────────────────────
function handleFileInputChangeEvent(e) {
    const input = e.target;
    if (!input || input.type !== 'file' || e.__extensionProcessed) return;
    if (!input.files || input.files.length === 0) return;

    console.log('[urforge] Change event intercepted on file input:', input);
    e.preventDefault();
    e.stopImmediatePropagation();

    const selectedFiles = Array.from(input.files);
    handleFiles(selectedFiles, (newFiles) => {
        try {
            const dt = new DataTransfer();
            (newFiles || []).forEach(f => {
                if (f && f instanceof File) {
                    dt.items.add(f);
                } else if (f && f instanceof Blob) {
                    dt.items.add(new File([f], f.name || 'file', { type: f.type || 'application/octet-stream' }));
                } else {
                    console.warn('[urforge] Skipping non-File item in DataTransfer:', f);
                }
            });
            input.files = dt.files;
        } catch (dtErr) {
            console.error('[urforge] DataTransfer assignment error:', dtErr);
        }

        // Re-dispatch event
        const newEvent = new Event('change', { bubbles: true });
        newEvent.__extensionProcessed = true;
        input.dispatchEvent(newEvent);
        console.log('[urforge] Re-dispatched processed change event.');
    }, input);
}

function attachInput(input) {
    if (!input || input.__urforgeAttached) return;
    input.__urforgeAttached = true;
    broadenFileInput(input);

    input.addEventListener('change', handleFileInputChangeEvent, true);
}

// Hook prototype click/showPicker in content script context as well
const originalInputClick = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') {
        attachInput(this);
        broadenFileInput(this);
    }
    return originalInputClick.apply(this, arguments);
};

if (HTMLInputElement.prototype.showPicker) {
    const originalInputShowPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () {
        if (this.type === 'file') {
            attachInput(this);
            broadenFileInput(this);
        }
        return originalInputShowPicker.apply(this, arguments);
    };
}

// Find file input related to clicked labels or elements
function findRelatedFileInput(target) {
    if (!target) return null;
    if (target.tagName === 'INPUT' && target.type === 'file') return target;
    const label = target.closest ? target.closest('label') : null;
    if (label) {
        if (label.htmlFor) {
            const el = document.getElementById(label.htmlFor);
            if (el && el.tagName === 'INPUT' && el.type === 'file') return el;
        }
        const nestedInput = label.querySelector('input[type="file"]');
        if (nestedInput) return nestedInput;
    }
    return null;
}

['pointerdown', 'mousedown', 'click', 'focusin'].forEach(evtName => {
    document.addEventListener(evtName, (e) => {
        const fileInput = findRelatedFileInput(e.target);
        if (fileInput) {
            attachInput(fileInput);
            broadenFileInput(fileInput);
        }
    }, true);
});

// Observe existing inputs and dynamic DOM mutations (React, Vue, Angular, etc.)
function scanAndAttachInputs() {
    document.querySelectorAll('input[type="file"]').forEach(attachInput);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndAttachInputs);
} else {
    scanAndAttachInputs();
}

const domObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
        if (m.type === 'childList') {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'INPUT' && node.type === 'file') {
                        attachInput(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('input[type="file"]').forEach(attachInput);
                    }
                }
            }
        } else if (m.type === 'attributes' && m.attributeName === 'accept') {
            if (m.target && m.target.tagName === 'INPUT' && m.target.type === 'file') {
                const newAccept = m.target.getAttribute('accept');
                if (newAccept && newAccept !== BROADENED_IMAGE_ACCEPT) {
                    if (isImageAcceptString(newAccept)) {
                        inputOriginalAcceptMap.set(m.target, newAccept);
                        if (m.target.dataset) m.target.dataset.urforgeOrigAccept = newAccept;
                        m.target.setAttribute('accept', BROADENED_IMAGE_ACCEPT);
                    } else {
                        inputOriginalAcceptMap.delete(m.target);
                        if (m.target.dataset) delete m.target.dataset.urforgeOrigAccept;
                    }
                }
            }
        }
    }
});

if (document.documentElement) {
    domObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['accept']
    });
}

// Global change event capture fallback
document.addEventListener('change', handleFileInputChangeEvent, true);
