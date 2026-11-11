// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Popup ↔ Background Messaging
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

/**
 * Translate raw errors into user-friendly messages with optional detail.
 */
function friendlyError(raw: string): { message: string; detail?: string } {
  const msg = (raw || '').toLowerCase();

  if (msg.includes('could not establish connection') || msg.includes('receiving end does not exist'))
    return { message: 'Wallet service is starting up. Please close and reopen the popup.', detail: raw };

  if (msg.includes('wrong password') || msg.includes('decrypt') || msg.includes('incorrect password'))
    return { message: 'Incorrect password. Please try again.' };
  if (msg.includes('invalid mnemonic') || msg.includes('invalid seed'))
    return { message: 'Invalid seed phrase. Please check that all words are correct and in the right order.' };

  if (msg.includes('insufficient funds') || msg.includes('insufficient balance'))
    return { message: 'Insufficient balance to complete this transaction (including gas fees).' };
  if (msg.includes('user rejected') || msg.includes('user denied'))
    return { message: 'Transaction was cancelled.' };

  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('failed to fetch'))
    return { message: 'Network error. Please check your internet connection.', detail: raw };

  if (msg.includes('invalid address'))
    return { message: 'The address you entered is not valid. Please double-check it.' };

  const cleaned = raw.replace(/^Error:\s*/i, '');
  return { message: cleaned, detail: undefined };
}

/**
 * Send a typed message to the background service worker.
 */
export async function sendMessage<T = any>(type: string, payload?: any): Promise<T> {
  try {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (response?.error) {
      const rawMessage = typeof response.error === 'string' ? response.error : response.error?.message;
      const { message } = friendlyError(rawMessage || 'Unknown error');
      const err = new Error(message);
      (err as any).detail = response.stack || rawMessage;
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
  exportMnemonic: (password: string) => sendMessage<string>('granite_exportMnemonic', { password }),
  getWallets: () => sendMessage<any[]>('granite_getWallets'),
  getActiveWallet: () => sendMessage<any>('granite_getActiveWallet'),
  setActiveWallet: (walletId: string) => sendMessage<boolean>('granite_setActiveWallet', { walletId }),
  getAddress: (chain: string) => sendMessage<string>('granite_getAddress', { chain }),
  getAddresses: () => sendMessage<Record<string, string>>('granite_getAddresses'),
  getActiveChain: () => sendMessage<string>('granite_getActiveChain'),
  setActiveChain: (chain: string) => sendMessage<boolean>('granite_setActiveChain', { chain }),
  getBalances: (chain?: string) => sendMessage<any[]>('granite_getBalances', chain ? { chain } : undefined),
  getAllChainBalances: () => sendMessage<Record<string, any[]>>('granite_getAllChainBalances'),
  sendTransaction: (params: any) => sendMessage<string>('granite_sendTransaction', params),
  estimateGas: (params: any) => sendMessage<any>('granite_estimateGas', params),
  getTransactionHistory: (chain?: string) =>
    sendMessage<any[]>('granite_getTransactionHistory', chain ? { chain } : undefined),
  getTokenPrice: (symbol: string) => sendMessage<number>('granite_getTokenPrice', { symbol }),
  validateAddress: (chain: string, address: string) =>
    sendMessage<{ valid: boolean; error?: string }>('granite_validateAddress', { chain, address }),
  getPendingApprovals: () => sendMessage<any[]>('granite_getPendingApprovals'),
  approveRequest: (id: string) => sendMessage<boolean>('granite_approveRequest', { id }),
  rejectRequest: (id: string, reason?: string) => sendMessage<boolean>('granite_rejectRequest', { id, reason }),
  getConnectedDApps: () => sendMessage<any[]>('granite_getConnectedDApps'),
  disconnectDApp: (origin: string) => sendMessage<boolean>('granite_disconnectDApp', { origin }),
};
