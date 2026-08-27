// main-world.js

(function() {
    // Monkey-patch FormData
    const originalAppend = FormData.prototype.append;
    FormData.prototype.append = function(name, value, filename) {
        if (value instanceof File) {
            // We could communicate with content-script here via window.postMessage
            // For now, just pass through
            console.log('Intercepted FormData.append:', name, value);
        }
        return originalAppend.apply(this, arguments);
    };

    // Monkey-patch fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        // Intercept if Request contains FormData or File
        return originalFetch.apply(this, args);
    };

    // Monkey-patch showOpenFilePicker
    if (window.showOpenFilePicker) {
        const originalShowOpenFilePicker = window.showOpenFilePicker;
        window.showOpenFilePicker = async function(options) {
            const handles = await originalShowOpenFilePicker.call(this, options);
            console.log('Intercepted showOpenFilePicker', handles);
            return handles;
        };
    }
})();
