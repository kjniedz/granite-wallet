// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Background Service Worker (Manifest V3)
// © 2026 Black Mountain Investment Group LLC
//
// IMPORTANT: polyfills must be imported FIRST — bip39 needs Buffer
// ═══════════════════════════════════════════════════════════════════

import '../polyfills';
import {
  GraniteWallet,
  Chain,
  CHAIN_CONFIGS,
  ChromeStorageBackend,
  ChromeSessionBackend,
  getChainByChainId,
} from '@granite/wallet-core';

// ─── Wallet Instance ───
// MV3 service workers are stopped after ~30 s of idle time and started
// again on the next event, so the engine restores its unlocked session
// and persisted state before the first request is answered.
const wallet = new GraniteWallet(new ChromeStorageBackend(), new ChromeSessionBackend());
const ready = wallet.init().catch((err) => console.error('[Granite] init failed', err));

// ─── Pending Approval Requests ───
// When a dApp requests a transaction or signature, we store it here
// and open the popup for user confirmation.
interface PendingApproval {
  id: string;
  type: 'transaction' | 'sign_message' | 'sign_typed_data' | 'connect';
  origin: string;
  data: any;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

const pendingApprovals = new Map<string, PendingApproval>();
let approvalIdCounter = 0;

// Auto-lock after 5 minutes of inactivity
const LOCK_ALARM_NAME = 'granite_auto_lock';
const LOCK_TIMEOUT_MINUTES = 5;

/** JSON-RPC methods that are plain chain reads and go straight to the RPC. */
const PASSTHROUGH_METHODS = new Set([
  'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_feeHistory',
  'eth_maxPriorityFeePerGas', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt',
  'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getLogs', 'eth_sendRawTransaction',
  'eth_getTransactionByBlockHashAndIndex', 'eth_getTransactionByBlockNumberAndIndex',
]);

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// ─── Message Handler ───
// All communication with popup and content scripts goes through here.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      // Expected refusals (wrong password, user rejected, not connected)
      // are not worth an error line; real failures are.
      if (err instanceof RpcError || /password|rejected/i.test(err?.message)) {
        console.warn('[Granite Background]', message?.type, err?.message);
      } else {
        console.error('[Granite Background]', message?.type, err);
      }
      sendResponse({
        error: { code: err?.code ?? -32603, message: err?.message || String(err) },
        stack: err?.stack,
      });
    });
  return true; // Keep the message channel open for async response
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender) {
  await ready;
  const { type, payload } = message;

  if (sender.id !== chrome.runtime.id) {
    throw new RpcError(4100, 'Unauthorized sender');
  }

  // dApp traffic arrives through the content script, which lives in a tab.
  if (type === 'granite_dapp_request') {
    return handleDAppRequest(payload, sender);
  }

  // Everything else controls the wallet and may only come from the
  // extension's own pages (the popup, whether docked, in a tab or in the
  // fallback window), never from a content script running in a site.
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) {
    throw new RpcError(4100, 'Wallet control messages are not accepted from pages');
  }

  // Reset auto-lock timer on any popup activity
  resetAutoLock();
  await wallet.touch();

  switch (type) {
    // ─── Wallet Lifecycle ───

    case 'granite_hasVault':
      return { result: await wallet.hasVault() };

    case 'granite_isUnlocked':
      return { result: wallet.isUnlocked() };

    case 'granite_createWallet': {
      const { password, name, strength } = payload;
      const { mnemonic, wallet: w } = await wallet.createWallet(password, name, strength);
      return { result: { mnemonic, wallet: w } };
    }

    case 'granite_importWallet': {
      const { password, name, mnemonic } = payload;
      const w = await wallet.importWallet(password, name, mnemonic);
      return { result: w };
    }

    case 'granite_unlock': {
      const wallets = await wallet.unlock(payload.password);
      return { result: wallets };
    }

    case 'granite_lock':
      wallet.lock();
      await broadcastEvent({ type: 'accountsChanged', accounts: [] });
      return { result: true };

    case 'granite_exportMnemonic':
      return { result: await wallet.exportMnemonic(payload.password) };

    // ─── Account Info ───

    case 'granite_getWallets':
      return { result: await wallet.getWallets() };

    case 'granite_getActiveWallet':
      return { result: await wallet.getActiveWallet() };

    case 'granite_setActiveWallet':
      wallet.setActiveWallet(payload.walletId);
      return { result: true };

    case 'granite_getAddress':
      return { result: await wallet.getAddress(payload.chain) };

    case 'granite_getAddresses':
      return { result: await wallet.getAddresses() };

    case 'granite_getActiveChain':
      return { result: wallet.getActiveChain() };

    case 'granite_setActiveChain':
      await switchChain(payload.chain);
      return { result: true };

    // ─── Balances ───

    case 'granite_getBalances':
      return { result: await wallet.getBalances(payload?.chain) };

    case 'granite_getAllChainBalances':
      return { result: await wallet.getAllChainBalances() };

    // ─── Transactions ───

    case 'granite_sendTransaction':
      return { result: await wallet.sendTransaction(payload) };

    case 'granite_estimateGas':
      return { result: await wallet.estimateGas(payload) };

    case 'granite_getTransactionHistory':
      return { result: wallet.getTransactionHistory(payload?.chain) };

    // ─── dApp Management ───

    case 'granite_getConnectedDApps':
      return { result: wallet.getConnectedDApps() };

    case 'granite_disconnectDApp':
      await wallet.disconnectDApp(payload.origin);
      await broadcastEvent({ type: 'accountsChanged', accounts: [] }, payload.origin);
      return { result: true };

    // ─── Prices ───

    case 'granite_getTokenPrice':
      return { result: await wallet.getTokenPrice(payload.symbol) };

    // ─── Validation ───

    case 'granite_validateAddress':
      return { result: wallet.validateAddress(payload.chain, payload.address) };

    // ─── Approval Requests ───
    // These are stored pending requests from dApps that need user approval.

    case 'granite_getPendingApprovals':
      return {
        result: Array.from(pendingApprovals.values()).map(({ resolve, reject, ...rest }) => rest),
      };

    case 'granite_approveRequest': {
      const approval = pendingApprovals.get(payload.id);
      if (!approval) throw new Error('This request has expired.');
      pendingApprovals.delete(payload.id);
      // Wait for the result so the popup can show a signing or sending error.
      await new Promise<void>((done, fail) => {
        const original = approval.reject;
        approval.reject = (err) => { original(err); fail(err); };
        approval.resolve = ((inner) => (result: any) => { inner(result); done(); })(approval.resolve);
        runApproval(approval);
      });
      return { result: true };
    }

    case 'granite_rejectRequest': {
      const rejection = pendingApprovals.get(payload.id);
      if (rejection) {
        rejection.reject(new RpcError(4001, payload.reason || 'User rejected the request'));
        pendingApprovals.delete(payload.id);
      }
      return { result: true };
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// ─── EIP-1193 dApp Request Handler ───
// Translates Ethereum JSON-RPC requests from dApps into wallet operations.

async function handleDAppRequest(payload: any, sender: chrome.runtime.MessageSender) {
  const { method, params = [] } = payload;
  // The sender's own origin, never the page-supplied one.
  const origin = senderOrigin(sender) || payload.origin || 'unknown';
  const siteName = sender.tab?.title || origin;
  const favicon = sender.tab?.favIconUrl || '';
  const chain = wallet.getActiveChain();
  const config = CHAIN_CONFIGS[chain];

  switch (method) {
    case 'eth_requestAccounts':
    case 'wallet_requestPermissions': {
      if (wallet.isUnlocked() && wallet.isDAppConnected(origin)) {
        const address = await wallet.getAddress(chain);
        return { result: method === 'eth_requestAccounts' ? (address ? [address] : []) : permissionsFor(origin) };
      }
      // The popup asks for the password first when the wallet is locked,
      // then shows this request, so a locked wallet is not an error.
      const accounts = await requestApproval('connect', origin, {
        method: 'eth_requestAccounts',
        origin,
        siteName,
        favicon,
        address: wallet.isUnlocked() ? await wallet.getAddress(chain) : null,
      });
      return { result: method === 'eth_requestAccounts' ? accounts : permissionsFor(origin) };
    }

    case 'eth_accounts': {
      if (!wallet.isUnlocked() || !wallet.isDAppConnected(origin)) return { result: [] };
      const address = await wallet.getAddress(chain);
      return { result: address ? [address] : [] };
    }

    case 'wallet_getPermissions':
      return { result: wallet.isDAppConnected(origin) ? permissionsFor(origin) : [] };

    case 'wallet_revokePermissions':
      await wallet.disconnectDApp(origin);
      return { result: null };

    case 'eth_chainId':
      return { result: '0x' + config.chainId.toString(16) };

    case 'net_version':
      return { result: config.chainId.toString() };

    case 'web3_clientVersion':
      return { result: `GraniteWallet/${chrome.runtime.getManifest().version}` };

    case 'personal_sign': {
      requireConnected(origin);
      // Spec order is [message, address]; some sites send [address, message].
      let [message, address] = params;
      if (isAddress(message) && !isAddress(address)) [message, address] = [address, message];
      requireOwnAddress(origin, address);
      const signResult = await requestApproval('sign_message', origin, {
        method: 'personal_sign', message, address, origin, siteName,
      });
      return { result: signResult };
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      requireConnected(origin);
      const [address, raw] = params;
      requireOwnAddress(origin, address);
      const typedData = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!typedData?.domain || !typedData?.types || typedData.message === undefined) {
        throw new RpcError(-32602, 'Malformed typed data');
      }
      const signResult = await requestApproval('sign_typed_data', origin, {
        method, address, typedData, origin, siteName,
      });
      return { result: signResult };
    }

    case 'eth_sign':
      throw new RpcError(4200, 'eth_sign is disabled because it can sign arbitrary transactions. Use personal_sign.');

    case 'eth_sendTransaction': {
      requireConnected(origin);
      const [txParams] = params;
      if (!txParams || typeof txParams !== 'object') throw new RpcError(-32602, 'Missing transaction');
      requireOwnAddress(origin, txParams.from);
      const txResult = await requestApproval('transaction', origin, {
        method: 'eth_sendTransaction',
        from: txParams.from,
        to: txParams.to,
        value: txParams.value || '0x0',
        data: txParams.data,
        gas: txParams.gas,
        gasPrice: txParams.gasPrice,
        maxFeePerGas: txParams.maxFeePerGas,
        maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
        origin,
        siteName,
        chain,
        chainId: config.chainId,
        chainName: config.name,
      });
      return { result: txResult };
    }

    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain': {
      const [{ chainId } = { chainId: undefined }] = params;
      const targetChainId = parseInt(chainId, 16);
      const chainConfig = getChainByChainId(targetChainId);
      if (!chainConfig || chainConfig.chain === Chain.SOLANA) {
        throw new RpcError(4902, `Chain ${chainId} is not supported by Granite Wallet`);
      }
      await switchChain(chainConfig.chain);
      return { result: null };
    }

    default:
      if (PASSTHROUGH_METHODS.has(method)) {
        return { result: await wallet.sendRawRPC(method, params) };
      }
      throw new RpcError(4200, `Unsupported method: ${method}`);
  }
}

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    return null;
  }
}

function isAddress(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function requireConnected(origin: string) {
  if (!wallet.isDAppConnected(origin)) {
    throw new RpcError(4100, 'This site is not connected. Call eth_requestAccounts first.');
  }
}

function requireOwnAddress(origin: string, address: unknown) {
  const session = wallet.getConnectedDApps().find((d) => d.origin === origin);
  const ok = isAddress(address) &&
    session?.accounts.some((a) => a.toLowerCase() === (address as string).toLowerCase());
  if (!ok) throw new RpcError(4100, 'The requested account is not available to this site');
}

function permissionsFor(origin: string) {
  return [{ parentCapability: 'eth_accounts', invoker: origin, date: Date.now() }];
}

async function switchChain(chain: Chain) {
  wallet.setActiveChain(chain);
  await broadcastEvent({ type: 'chainChanged', chainId: CHAIN_CONFIGS[chain].chainId });
  const address = await wallet.getAddress(chain);
  await broadcastEvent({ type: 'accountsChanged', accounts: address ? [address] : [] });
}

// ─── Approval Request Flow ───
// Opens the popup and waits for the user to approve or reject.

function requestApproval(type: PendingApproval['type'], origin: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `approval_${++approvalIdCounter}_${Date.now()}`;

    pendingApprovals.set(id, { id, type, origin, data, resolve, reject, createdAt: Date.now() });
    keepAliveWhilePending();
    void openPopup();

    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        reject(new RpcError(4001, 'Approval request timed out'));
      }
    }, 300_000);
  });
}

/** Perform what the user just approved and hand the result to the dApp. */
async function runApproval(approval: PendingApproval) {
  const { type, data, origin } = approval;
  try {
    let result: any;
    const chain = wallet.getActiveChain();

    if (type === 'transaction') {
      result = await wallet.sendDAppTransaction({
        chain: data.chain || chain,
        from: data.from,
        to: data.to,
        value: data.value,
        data: data.data,
        gas: data.gas,
        gasPrice: data.gasPrice,
        maxFeePerGas: data.maxFeePerGas,
        maxPriorityFeePerGas: data.maxPriorityFeePerGas,
      });
    } else if (type === 'sign_message') {
      result = await wallet.signMessage(chain, data.address, data.message);
    } else if (type === 'sign_typed_data') {
      const td = data.typedData;
      result = await wallet.signTypedData(chain, data.address, td.domain, td.types, td.message);
    } else if (type === 'connect') {
      const session = await wallet.connectDApp(origin, data.siteName);
      result = session.accounts;
      await broadcastEvent({ type: 'connect', chainId: session.chainId }, origin);
    }

    approval.resolve(result);
  } catch (err: any) {
    approval.reject(err);
  }
}

// The service worker may be stopped while a dApp waits on the popup.
// A cheap API call every 20 s keeps it alive until the queue drains.
let keepAlive: ReturnType<typeof setInterval> | null = null;
function keepAliveWhilePending() {
  if (keepAlive) return;
  keepAlive = setInterval(() => {
    if (pendingApprovals.size === 0) {
      clearInterval(keepAlive!);
      keepAlive = null;
      return;
    }
    chrome.runtime.getPlatformInfo(() => {});
  }, 20_000);
}

// ─── Events to pages ───
// accountsChanged goes only to sites that are connected (or the one
// named); chainChanged is public information and goes everywhere.

async function broadcastEvent(event: any, onlyOrigin?: string) {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  const connected = new Set(wallet.getConnectedDApps().map((d) => d.origin));
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let origin: string;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }
    if (onlyOrigin && origin !== onlyOrigin) continue;
    if (event.type !== 'chainChanged' && !onlyOrigin && !connected.has(origin)) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'granite_event', event }).catch(() => {});
  }
}

// ─── Auto-Lock ───

function resetAutoLock() {
  chrome.alarms.create(LOCK_ALARM_NAME, { delayInMinutes: LOCK_TIMEOUT_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM_NAME) {
    wallet.lock();
    void broadcastEvent({ type: 'accountsChanged', accounts: [] });
    chrome.runtime.sendMessage({ type: 'granite_locked' }).catch(() => {});
  }
});

// ─── Popup Helper ───

async function openPopup() {
  try {
    await chrome.action.openPopup();
  } catch {
    // Fallback: open as window
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 380,
      height: 620,
      focused: true,
    });
  }
}

// ─── Extension Install/Update ───

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Granite Wallet installed. Welcome!');
  } else if (details.reason === 'update') {
    console.log(`Granite Wallet updated to v${chrome.runtime.getManifest().version}`);
  }
});

console.log('Granite Wallet background service worker started.');
