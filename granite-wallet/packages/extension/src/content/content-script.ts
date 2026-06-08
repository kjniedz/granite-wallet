// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Content Script
// © 2026 Black Mountain Investment Group LLC
//
// This content script runs on every page and acts as a bridge
// between the injected Web3 provider (inpage.js) and the
// background service worker.
//
// Message flow:
// dApp page (window.ethereum) → inpage.js → window.postMessage →
// content script (here) → chrome.runtime.sendMessage → background
// ═══════════════════════════════════════════════════════════════════

// Inject the inpage script that provides window.ethereum
function injectProvider() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inpage.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.error('Granite Wallet: Failed to inject provider', err);
  }
}

// Inject before anything else runs
injectProvider();

// ─── Message Relay: page ↔ background ───

// Listen for messages from the injected inpage script
window.addEventListener('message', async (event) => {
  // Only accept messages from the same page
  if (event.source !== window) return;
  if (!event.data || event.data.target !== 'granite-content-script') return;

  const { id, method, params } = event.data;

  try {
    // Forward to background service worker
    const response = await chrome.runtime.sendMessage({
      type: 'granite_dapp_request',
      payload: {
        method,
        params,
        origin: window.location.origin,
      },
    });

    // Send response back to the page
    window.postMessage(
      {
        target: 'granite-inpage',
        id,
        result: response?.result,
        error: response?.error,
      },
      '*'
    );
  } catch (err: any) {
    window.postMessage(
      {
        target: 'granite-inpage',
        id,
        error: err.message || 'Unknown error',
      },
      '*'
    );
  }
});

// Listen for events from background (chain changed, accounts changed, etc.)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'granite_event') {
    window.postMessage(
      {
        target: 'granite-inpage',
        type: 'event',
        event: message.event,
      },
      '*'
    );
  }
});

console.log('Granite Wallet content script loaded.');
