// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Popup ↔ Background Messaging
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

/**
 * Translate raw errors into user-friendly messages with optional detail.
 */
function friendlyError(raw: string): { message: string; detail?: string } {
  const msg = (raw || '').toLowerCase();

  // Connection / extension errors
  if (msg.includes('could not establish connection') || msg.includes('receiving end does not exist'))
    return { message: 'Wallet service is starting up. Please close and reopen the popup.', detail: raw };

  // Wallet lifecycle
  if (msg.includes('wrong password') || msg.includes('decrypt'))
    return { message: 'Incorrect password. Please try again.' };
  if (msg.includes('invalid mnemonic') || msg.includes('invalid seed'))
    return { message: 'Invalid seed phrase. Please check that all words are correct and in the right order.' };

  // Transaction errors
  if (msg.includes('insufficient funds') || msg.includes('insufficient balance'))
    return { message: 'Insufficient balance to complete this transaction (including gas fees).' };
  if (msg.includes('user rejected') || msg.includes('user denied'))
    return { message: 'Transaction was cancelled.' };

  // Network
  if (msg.includes('network') || msg.includes('econnrefused'))
    return { message: 'Network error. Please check your internet connection.', detail: raw };

  // Address
  if (msg.includes('invalid address'))
    return { message: 'The address you entered is not valid. Please double-check it.' };

  // Swap
  if (msg.includes('no swap routes') || msg.includes('no route'))
    return { message: 'No swap route found for this pair. Try a different token or amount.' };
  if (msg.includes('slippage'))
    return { message: 'Transaction failed due to price movement. Try increasing slippage tolerance.' };

  // For anything else: show the REAL error — don't hide it
  const cleaned = raw.replace(/^Error:\s*/i, '');
  return { message: cleaned, detail: undefined };
}

/**
 * Send a typed message to the background service worker.
 */
export async function sendMessage<T = any>(
  type: string,
  payload?: any
): Promise<T> {
  try {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (response?.error) {
      const { message, detail } = friendlyError(response.error);
      const err = new Error(message);
      // Include the raw error + stack from background for debugging
      (err as any).detail = response.stack || response.error;
      throw err;
    }
    return response?.result;
  } catch (err: any) {
    if (err?.detail) throw err; // Already processed
    const { message, detail } = friendlyError(err?.message || String(err));
    const newErr = new Error(message);
    (newErr as any).detail = detail || err?.stack || err?.message;
    throw newErr;
  }
}

// ─── Typed API methods ───

export const api = {
  hasVault: () => sendMessage<boolean>('granite_hasVault'),
  isUnlocked: () => sendMessage<boolean>('granite_isUnlocked'),
  createWallet: (password: string, name: string, strength?: 128 | 256) =>
    sendMessage<{ mnemonic: string; wallet: any }>('granite_createWallet', { password, name, strength }),
  importWallet: (password: string, name: string, mnemonic: string) =>
    sendMessage<any>('granite_importWallet', { password, name, mnemonic }),
  unlock: (password: string) => sendMessage<any[]>('granite_unlock', { password }),
  lock: () => sendMessage<boolean>('granite_lock'),
  getWallets: () => sendMessage<any[]>('granite_getWallets'),
  getActiveWallet: () => sendMessage<any>('granite_getActiveWallet'),
  setActiveWallet: (walletId: string) =>
    sendMessage<boolean>('granite_setActiveWallet', { walletId }),
  getAddress: (chain: string) => sendMessage<string>('granite_getAddress', { chain }),
  getAddresses: () => sendMessage<Record<string, string>>('granite_getAddresses'),
  getActiveChain: () => sendMessage<string>('granite_getActiveChain'),
  setActiveChain: (chain: string) => sendMessage<boolean>('granite_setActiveChain', { chain }),
  getBalances: (chain?: string) => sendMessage<any[]>('granite_getBalances', chain ? { chain } : undefined),
  getAllChainBalances: () => sendMessage<Record<string, any[]>>('granite_getAllChainBalances'),
  sendTransaction: (params: any) => sendMessage<string>('granite_sendTransaction', params),
  estimateGas: (params: any) => sendMessage<any>('granite_estimateGas', params),
  signMessage: (chain: string, address: string, message: string) =>
    sendMessage<string>('granite_signMessage', { chain, address, message }),
  getSwapQuote: (params: any) => sendMessage<any>('granite_getSwapQuote', params),
  executeSwap: (params: any) => sendMessage<string>('granite_executeSwap', params),
  getTokenPrice: (symbol: string) => sendMessage<number>('granite_getTokenPrice', { symbol }),
  getExchangeRate: (fromSymbol: string, toSymbol: string) =>
    sendMessage<number>('granite_getExchangeRate', { fromSymbol, toSymbol }),
  validateAddress: (chain: string, address: string) =>
    sendMessage<{ valid: boolean; error?: string }>('granite_validateAddress', { chain, address }),
  getPendingApprovals: () => sendMessage<any[]>('granite_getPendingApprovals'),
  approveRequest: (id: string, result?: any) =>
    sendMessage<boolean>('granite_approveRequest', { id, result }),
  rejectRequest: (id: string, reason?: string) =>
    sendMessage<boolean>('granite_rejectRequest', { id, reason }),
  getConnectedDApps: () => sendMessage<any[]>('granite_getConnectedDApps'),
  disconnectDApp: (origin: string) => sendMessage<boolean>('granite_disconnectDApp', { origin }),
};
