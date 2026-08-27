// background.js

let creating; // Promise for offscreen document creation
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

async function setupOffscreenDocument(path) {
  if (await hasDocument()) return;
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER', 'WORKERS'],
      justification: 'Perform file compression in isolated context',
    });
    await creating;
    creating = null;
  }
}

async function hasDocument() {
  const matchedClients = await clients.matchAll();
  return matchedClients.some(c => c.url.endsWith(OFFSCREEN_DOCUMENT_PATH));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COMPRESS_FILE' && message.target !== 'offscreen') {
    (async () => {
      await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
      
      // Pass the message to the offscreen document with retry acknowledgment
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const res = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              target: 'offscreen',
              type: 'COMPRESS_FILE',
              fileId: message.fileId,
              fileData: message.fileData,
              fileType: message.fileType,
              fileName: message.fileName,
              options: message.options,
              tabId: sender && sender.tab ? sender.tab.id : message.tabId,
              requestId: message.requestId
            }, (response) => {
              const err = chrome.runtime.lastError;
              if (err) reject(err);
              else resolve(response);
            });
          });
          if (res && res.ack) {
            console.log('[UpForge SW] Message successfully acknowledged by offscreen.');
            sendResponse({ ack: true });
            return;
          }
        } catch (e) {
          console.warn('[UpForge SW] Offscreen not ready yet, retrying attempt:', attempt + 1);
        }
        await new Promise(r => setTimeout(r, 100));
      }
      sendResponse({ ack: false, error: 'Offscreen document failed to acknowledge' });
    })();
    return true; 
  }
  
  // Forward messages from offscreen document back to the specific content script tab
  if (['COMPRESSION_PROGRESS', 'COMPRESSION_COMPLETE', 'COMPRESSION_ERROR'].includes(message.type)) {
      if (message.tabId) {
          chrome.tabs.sendMessage(message.tabId, message);
      }
  }
});
