// main-world.js

(function () {
    const IMAGE_EXTENSIONS = new Set([
        'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff',
        'heic', 'heif', 'jfif', 'ico', 'pjpeg', 'pjp', 'svg'
    ]);
    const BROADENED_IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,.heic,.heif,.jfif,.ico,image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/tiff,image/heic,image/heif';

    function isPureImageAccept(accept) {
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
                return false;
            }
            return false;
        }
        return true;
    }

    function broadenFileInputAccept(input) {
        if (!input || input.type !== 'file') return;
        const currentAccept = input.getAttribute('accept');
        if (!currentAccept || currentAccept === BROADENED_IMAGE_ACCEPT) return;

        if (isPureImageAccept(currentAccept)) {
            if (!input.dataset.urforgeOrigAccept) {
                input.dataset.urforgeOrigAccept = currentAccept;
            }
            input.setAttribute('accept', BROADENED_IMAGE_ACCEPT);
        }
    }

    // Monkey-patch HTMLInputElement click & showPicker to broaden image file picker on invocation
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
        if (this.type === 'file') {
            broadenFileInputAccept(this);
        }
        return originalClick.apply(this, arguments);
    };

    if (HTMLInputElement.prototype.showPicker) {
        const originalShowPicker = HTMLInputElement.prototype.showPicker;
        HTMLInputElement.prototype.showPicker = function () {
            if (this.type === 'file') {
                broadenFileInputAccept(this);
            }
            return originalShowPicker.apply(this, arguments);
        };
    }

    // Monkey-patch FormData
    const originalAppend = FormData.prototype.append;
    FormData.prototype.append = function (name, value, filename) {
        if (value instanceof File) {
            console.log('Intercepted FormData.append:', name, value);
        }
        return originalAppend.apply(this, arguments);
    };

    // Monkey-patch fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        return originalFetch.apply(this, args);
    };

    // Monkey-patch showOpenFilePicker
    if (window.showOpenFilePicker) {
        const originalShowOpenFilePicker = window.showOpenFilePicker;
        window.showOpenFilePicker = async function (options) {
            let broadenedOptions = options;
            if (options && Array.isArray(options.types) && options.types.length > 0) {
                let allTypesAreImage = true;
                for (const typeObj of options.types) {
                    if (!typeObj || !typeObj.accept) {
                        allTypesAreImage = false;
                        break;
                    }
                    const mimeKeys = Object.keys(typeObj.accept);
                    for (const mime of mimeKeys) {
                        if (!mime.startsWith('image/')) {
                            allTypesAreImage = false;
                            break;
                        }
                        const exts = typeObj.accept[mime];
                        if (Array.isArray(exts)) {
                            for (const ext of exts) {
                                const cleanExt = ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase();
                                if (!IMAGE_EXTENSIONS.has(cleanExt)) {
                                    allTypesAreImage = false;
                                    break;
                                }
                            }
                        }
                    }
                    if (!allTypesAreImage) break;
                }

                if (allTypesAreImage) {
                    broadenedOptions = {
                        ...options,
                        types: [
                            ...options.types,
                            {
                                description: 'All Supported Images (urforge)',
                                accept: {
                                    'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.jfif', '.ico']
                                }
                            }
                        ]
                    };
                }
            }
            const handles = await originalShowOpenFilePicker.call(this, broadenedOptions);
            console.log('Intercepted showOpenFilePicker', handles);
            return handles;
        };
    }
})();
