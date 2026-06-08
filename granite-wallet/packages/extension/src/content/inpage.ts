// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Inpage Web3 Provider (EIP-1193)
// © 2026 Black Mountain Investment Group LLC
//
// This script is injected into every page and provides the
// window.ethereum object that dApps use to interact with wallets.
//
// Implements EIP-1193 (Ethereum Provider JavaScript API).
// Compatible with MetaMask, ethers.js, web3.js, wagmi, etc.
// ═══════════════════════════════════════════════════════════════════

(() => {
  // Don't inject if already present (e.g., another extension)
  // We set ours as the default but don't override if user prefers another
  if ((window as any).__graniteWalletInjected) return;
  (window as any).__graniteWalletInjected = true;

  let requestId = 0;
  const pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  // ─── EIP-1193 Provider ───
  class GraniteProvider {
    isGranite = true;
    isMetaMask = true; // Compatibility: many dApps check for this
    _events: Record<string, Function[]> = {};
    chainId: string | null = null;
    selectedAddress: string | null = null;
    connected = false;
    networkVersion: string | null = null;

    constructor() {
      // Listen for responses from content script
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.target !== 'granite-inpage') return;

        const { id, result, error, type, event: walletEvent } = event.data;

        // Handle event broadcasts
        if (type === 'event' && walletEvent) {
          this._handleEvent(walletEvent);
          return;
        }

        // Handle RPC responses
        const pending = pendingRequests.get(id);
        if (pending) {
          pendingRequests.delete(id);
          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve(result);
          }
        }
      });
    }

    /**
     * EIP-1193: request method — the primary interface for dApps.
     */
    async request(args: { method: string; params?: any[] }): Promise<any> {
      const { method, params = [] } = args;

      return new Promise((resolve, reject) => {
        const id = ++requestId;
        pendingRequests.set(id, { resolve, reject });

        // Send to content script
        window.postMessage(
          {
            target: 'granite-content-script',
            id,
            method,
            params,
          },
          '*'
        );

        // Timeout after 60 seconds
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`Request timeout: ${method}`));
          }
        }, 60000);
      });
    }

    /**
     * Legacy: send method (deprecated but still used by some dApps).
     */
    send(method: string, params?: any[]): Promise<any> {
      return this.request({ method, params });
    }

    /**
     * Legacy: sendAsync (used by older web3.js versions).
     */
    sendAsync(
      payload: { method: string; params?: any[]; id: number },
      callback: (error: Error | null, response?: any) => void
    ): void {
      this.request({ method: payload.method, params: payload.params })
        .then((result) => {
          callback(null, {
            id: payload.id,
            jsonrpc: '2.0',
            result,
          });
        })
        .catch((err) => callback(err));
    }

    /**
     * Legacy: enable (deprecated, same as eth_requestAccounts).
     */
    async enable(): Promise<string[]> {
      return this.request({ method: 'eth_requestAccounts' });
    }

    // ─── Event Emitter (EIP-1193) ───

    on(event: string, listener: Function): this {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(listener);
      return this;
    }

    removeListener(event: string, listener: Function): this {
      if (this._events[event]) {
        this._events[event] = this._events[event].filter((l) => l !== listener);
      }
      return this;
    }

    removeAllListeners(event?: string): this {
      if (event) {
        delete this._events[event];
      } else {
        this._events = {};
      }
      return this;
    }

    emit(event: string, ...args: any[]): boolean {
      const listeners = this._events[event];
      if (listeners) {
        listeners.forEach((listener) => {
          try {
            listener(...args);
          } catch (err) {
            console.error(`Granite: Error in ${event} listener`, err);
          }
        });
        return true;
      }
      return false;
    }

    // Handle events from the wallet
    _handleEvent(event: any) {
      switch (event.type) {
        case 'accountsChanged':
          this.selectedAddress = event.accounts?.[0] || null;
          this.emit('accountsChanged', event.accounts);
          break;
        case 'chainChanged':
          this.chainId = '0x' + event.chainId.toString(16);
          this.networkVersion = event.chainId.toString();
          this.emit('chainChanged', this.chainId);
          break;
        case 'connect':
          this.connected = true;
          this.emit('connect', { chainId: '0x' + event.chainId.toString(16) });
          break;
        case 'disconnect':
          this.connected = false;
          this.selectedAddress = null;
          this.emit('disconnect');
          break;
      }
    }
  }

  // ─── Install Provider ───
  const provider = new GraniteProvider();

  // Set as window.ethereum
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: false,
    configurable: true,
  });

  // EIP-6963: Announce provider for modern dApps
  const info = {
    uuid: 'granite-wallet-001',
    name: 'Granite Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23023859" width="100" height="100" rx="20"/><path d="M50 15L80 75H20Z" fill="%230367A6" opacity="0.8"/><path d="M35 30L55 75H15Z" fill="%23C4E1F2" opacity="0.6"/></svg>',
    rdns: 'com.blackmountainig.granite',
  };

  // Announce via EIP-6963
  window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider }),
    })
  );

  // Listen for discovery requests
  window.addEventListener('eip6963:requestProvider', () => {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info, provider }),
      })
    );
  });

  console.log('⛰ Granite Wallet provider injected');
})();
