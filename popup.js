document.addEventListener('DOMContentLoaded', () => {
    initEngineSettings();
    renderList();
});

function initEngineSettings() {
    const radios = document.querySelectorAll('input[name="popup-engine"]');
    chrome.storage.sync.get(['defaultEngine'], (result) => {
        const engine = result.defaultEngine || 'wasm';
        const targetRadio = document.querySelector(`input[name="popup-engine"][value="${engine}"]`);
        if (targetRadio) {
            targetRadio.checked = true;
        }
    });

    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                chrome.storage.sync.set({ defaultEngine: e.target.value }, () => {
                    console.log('[urforge Popup] Default engine set to:', e.target.value);
                });
            }
        });
    });
}

function renderList() {
    const list = document.getElementById('exclusions-list');
    list.innerHTML = '';

    chrome.storage.sync.get(['excludedDomains'], (result) => {
        const domains = (result && result.excludedDomains) || [];
        if (domains.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No excluded sites yet.';
            list.appendChild(empty);
            return;
        }

        domains.forEach((domain) => {
            const item = document.createElement('div');
            item.className = 'exclusion-item';

            const name = document.createElement('span');
            name.className = 'exclusion-domain';
            name.textContent = domain;
            item.appendChild(name);

            const btn = document.createElement('button');
            btn.className = 'btn-remove';
            btn.textContent = 'Remove';
            btn.addEventListener('click', () => {
                const idx = domains.indexOf(domain);
                if (idx > -1) {
                    domains.splice(idx, 1);
                    chrome.storage.sync.set({ excludedDomains: domains }, () => {
                        renderList();
                    });
                }
            });
            item.appendChild(btn);
            list.appendChild(item);
        });
    });
}
