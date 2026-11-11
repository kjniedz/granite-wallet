// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Content Script (isolated world)
// © 2026 Black Mountain Investment Group LLC
//
// Relay between the provider injected into the page (inpage.js, which
// the manifest runs in the page's main world) and the background
// service worker. The page's origin is taken from the content script's
// own window, never from the message, so a page cannot impersonate
// another site.
//
// dApp page (window.ethereum) → inpage.js → window.postMessage →
// content script (here) → chrome.runtime.sendMessage → background
// ═══════════════════════════════════════════════════════════════════

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.target !== 'granite-content-script') return;

  const { id, method, params } = event.data;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'granite_dapp_request',
      payload: { method, params, origin: window.location.origin },
    });

    window.postMessage(
      { target: 'granite-inpage', id, result: response?.result, error: response?.error },
      window.location.origin
    );
  } catch (err: any) {
    window.postMessage(
      { target: 'granite-inpage', id, error: { code: -32603, message: err?.message || 'Unknown error' } },
      window.location.origin
    );
  }
});

// Events from the background (chainChanged, accountsChanged, ...)
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'granite_event') {
    window.postMessage(
      { target: 'granite-inpage', type: 'event', event: message.event },
      window.location.origin
    );
  }
});
