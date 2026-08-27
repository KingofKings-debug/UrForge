document.addEventListener('DOMContentLoaded', () => {
    renderList();
});

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
