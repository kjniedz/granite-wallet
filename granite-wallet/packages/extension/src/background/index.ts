// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Background Service Worker (Manifest V3)
// © 2026 Black Mountain Investment Group LLC
//
// IMPORTANT: polyfills must be imported FIRST — bip39 needs Buffer
// ═══════════════════════════════════════════════════════════════════

import '../polyfills';
import { GraniteWallet, Chain, CHAIN_CONFIGS, getChainByChainId } from '@granite/wallet-core';

// ─── Wallet Instance ───
const wallet = new GraniteWallet();

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

// ─── Message Handler ───
// All communication with popup and content scripts goes through here.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Granite Background]', message?.type, err);
      sendResponse({
        error: err?.message || String(err),
        stack: err?.stack,
      });
    });
  return true; // Keep the message channel open for async response
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender) {
  const { type, payload } = message;

  // Reset auto-lock timer on any activity
  resetAutoLock();

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
      return { result: true };

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
      wallet.setActiveChain(payload.chain);
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

    // ─── Signing ───

    case 'granite_signMessage':
      return { result: await wallet.signMessage(payload.chain, payload.address, payload.message) };

    case 'granite_signTypedData':
      return {
        result: await wallet.signTypedData(
          payload.chain,
          payload.address,
          payload.domain,
          payload.types,
          payload.value
        ),
      };

    // ─── dApp Connection (EIP-1193 requests from content script) ───

    case 'granite_dapp_request': {
      return handleDAppRequest(payload, sender);
    }

    // ─── dApp Management ───

    case 'granite_getConnectedDApps':
      return { result: wallet.getConnectedDApps() };

    case 'granite_disconnectDApp':
      wallet.disconnectDApp(payload.origin);
      return { result: true };

    // ─── Swaps ───

    case 'granite_getSwapQuote':
      return { result: await wallet.getSwapQuote(payload) };

    case 'granite_executeSwap':
      return { result: await wallet.executeSwap(payload) };

    // ─── Prices ───

    case 'granite_getTokenPrice':
      return { result: await wallet.getTokenPrice(payload.symbol) };

    case 'granite_getExchangeRate':
      return { result: await wallet.getExchangeRate(payload.fromSymbol, payload.toSymbol) };

    // ─── Validation ───

    case 'granite_validateAddress':
      return { result: wallet.validateAddress(payload.chain, payload.address) };

    // ─── Approval Requests ───
    // These are stored pending requests from dApps that need user approval.

    case 'granite_getPendingApprovals':
      return { result: Array.from(pendingApprovals.values()) };

    case 'granite_approveRequest': {
      const approval = pendingApprovals.get(payload.id);
      if (approval) {
        approval.resolve(payload.result);
        pendingApprovals.delete(payload.id);
      }
      return { result: true };
    }

    case 'granite_rejectRequest': {
      const rejection = pendingApprovals.get(payload.id);
      if (rejection) {
        rejection.reject(new Error(payload.reason || 'User rejected'));
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
  const { method, params, origin } = payload;

  switch (method) {
    case 'eth_requestAccounts': {
      if (!wallet.isUnlocked()) {
        await openPopup();
        throw new Error('Wallet is locked. Please unlock Granite Wallet.');
      }

      const chain = wallet.getActiveChain();
      const address = await wallet.getAddress(chain);

      // Check if already connected
      if (wallet.isDAppConnected(origin || '')) {
        return { result: address ? [address] : [] };
      }

      // Request user approval to connect
      const accounts = await requestApproval('connect', origin || sender.tab?.url || 'unknown', {
        method: 'eth_requestAccounts',
        origin: origin || sender.tab?.url || 'Unknown',
        siteName: sender.tab?.title || 'Unknown dApp',
        favicon: sender.tab?.favIconUrl || '',
        address,
      });

      return { result: accounts || (address ? [address] : []) };
    }

    case 'eth_accounts': {
      if (!wallet.isUnlocked()) return { result: [] };
      // Only return accounts if the dApp is already connected
      if (!wallet.isDAppConnected(origin || '')) return { result: [] };
      const chain = wallet.getActiveChain();
      const address = await wallet.getAddress(chain);
      return { result: address ? [address] : [] };
    }

    case 'eth_chainId': {
      const chain = wallet.getActiveChain();
      const config = CHAIN_CONFIGS[chain];
      return { result: '0x' + config.chainId.toString(16) };
    }

    case 'net_version': {
      const chain = wallet.getActiveChain();
      const config = CHAIN_CONFIGS[chain];
      return { result: config.chainId.toString() };
    }

    case 'personal_sign': {
      const [message, address] = params;
      // Show approval popup
      const signResult = await requestApproval('sign_message', origin || '', {
        method: 'personal_sign',
        message,
        address,
        origin: origin || sender.tab?.url || 'Unknown',
        siteName: sender.tab?.title || 'Unknown dApp',
      });
      return { result: signResult };
    }

    case 'eth_signTypedData_v4': {
      const [address, typedDataStr] = params;
      const typedData = JSON.parse(typedDataStr);
      const signResult = await requestApproval('sign_typed_data', origin || '', {
        method: 'eth_signTypedData_v4',
        address,
        typedData,
        origin: origin || sender.tab?.url || 'Unknown',
        siteName: sender.tab?.title || 'Unknown dApp',
      });
      return { result: signResult };
    }

    case 'eth_sendTransaction': {
      const [txParams] = params;
      // Show approval popup with transaction details
      const txResult = await requestApproval('transaction', origin || '', {
        method: 'eth_sendTransaction',
        from: txParams.from,
        to: txParams.to,
        value: txParams.value || '0',
        data: txParams.data,
        gas: txParams.gas,
        origin: origin || sender.tab?.url || 'Unknown',
        siteName: sender.tab?.title || 'Unknown dApp',
        chainId: CHAIN_CONFIGS[wallet.getActiveChain()].chainId,
        chainName: CHAIN_CONFIGS[wallet.getActiveChain()].name,
      });
      return { result: txResult };
    }

    case 'wallet_switchEthereumChain': {
      const [{ chainId }] = params;
      const targetChainId = parseInt(chainId, 16);
      const chainConfig = getChainByChainId(targetChainId);
      if (!chainConfig) {
        throw { code: 4902, message: `Chain ${chainId} not supported` };
      }
      wallet.setActiveChain(chainConfig.chain);
      return { result: null };
    }

    case 'wallet_addEthereumChain': {
      // TODO: Implement custom chain addition
      return { result: null };
    }

    case 'eth_getBalance':
    case 'eth_call':
    case 'eth_estimateGas':
    case 'eth_blockNumber':
    case 'eth_getTransactionReceipt':
    case 'eth_getTransactionByHash': {
      // Proxy these directly to the RPC provider
      // In production, use the EVMProvider's underlying JsonRpcProvider
      throw new Error(`RPC proxy for ${method} — TODO: implement direct RPC passthrough`);
    }

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

// ─── Approval Request Flow ───
// Opens the popup and waits for the user to approve or reject.

async function requestApproval(
  type: PendingApproval['type'],
  origin: string,
  data: any
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const id = `approval_${++approvalIdCounter}_${Date.now()}`;

    pendingApprovals.set(id, {
      id,
      type,
      origin,
      data,
      resolve: async (approved: any) => {
        try {
          let result: any;
          const chain = wallet.getActiveChain();

          if (type === 'transaction') {
            result = await wallet.sendTransaction({
              chain,
              from: data.from,
              to: data.to,
              value: data.value || '0',
              data: data.data,
              gasLimit: data.gas,
            });
          } else if (type === 'sign_message') {
            result = await wallet.signMessage(chain, data.address, data.message);
          } else if (type === 'sign_typed_data') {
            const td = data.typedData;
            result = await wallet.signTypedData(chain, data.address, td.domain, td.types, td.message);
          } else if (type === 'connect') {
            const session = await wallet.connectDApp(origin, data.siteName);
            result = session.accounts;
          }

          resolve(result);
        } catch (err: any) {
          reject(err);
        }
      },
      reject,
      createdAt: Date.now(),
    });

    // Open popup to show the approval UI
    await openPopup();

    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        reject(new Error('Approval request timed out'));
      }
    }, 300_000);
  });
}

// ─── Auto-Lock ───

function resetAutoLock() {
  chrome.alarms.clear(LOCK_ALARM_NAME);
  chrome.alarms.create(LOCK_ALARM_NAME, {
    delayInMinutes: LOCK_TIMEOUT_MINUTES,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM_NAME) {
    wallet.lock();
    // Notify popup if open
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
