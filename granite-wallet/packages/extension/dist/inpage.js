
/* ══ Granite Wallet — MV3 Service Worker Polyfills ══ */
(function(){
  /* Process shim (bip39 checks process.browser) */
  if(typeof globalThis.process==='undefined')
    globalThis.process={env:{},browser:true,version:'',nextTick:function(fn){Promise.resolve().then(fn)}};

  /* Document shim via Proxy — handles ANY property/method access safely.
     cipher-base calls document.getElementsByTagName('head') etc. */
  if(typeof globalThis.document==='undefined'){
    var noop=function(){return proxy};
    var proxy=typeof Proxy!=='undefined'?new Proxy(noop,{
      get:function(_,p){
        if(p===Symbol.toPrimitive||p==='toString'||p==='valueOf')return function(){return ''};
        if(p==='length'||p==='nodeType')return 0;
        if(p==='readyState')return 'complete';
        if(p==='childNodes'||p==='children'||p==='querySelectorAll'||p==='getElementsByTagName'||p==='getElementsByClassName')return function(){return[]};
        if(p==='getElementById'||p==='querySelector'||p==='parentNode'||p==='parentElement')return function(){return null};
        if(p==='createElement')return function(){return proxy};
        if(p==='head'||p==='body'||p==='documentElement'||p==='style')return proxy;
        if(p==='addEventListener'||p==='removeEventListener'||p==='appendChild'||p==='removeChild'||p==='setAttribute'||p==='insertBefore')return noop;
        if(typeof p==='string')return noop;
        return undefined;
      },
      set:function(){return true},
      apply:function(){return proxy}
    }):{};
    globalThis.document=proxy;
  }

  /* Window shim */
  if(typeof globalThis.window==='undefined') globalThis.window=globalThis;

  /* Navigator shim */
  if(typeof globalThis.navigator==='undefined')
    globalThis.navigator={userAgent:'GraniteWallet/1.0',platform:'ChromeExt',language:'en'};

  /* Storage shims */
  if(typeof globalThis.localStorage==='undefined')
    globalThis.localStorage={getItem:function(){return null},setItem:function(){},removeItem:function(){},clear:function(){}};

  /* XMLHttpRequest shim */
  if(typeof globalThis.XMLHttpRequest==='undefined'){
    globalThis.XMLHttpRequest=function(){};
    globalThis.XMLHttpRequest.prototype={open:function(){},send:function(){},setRequestHeader:function(){},addEventListener:function(){},abort:function(){}};
  }
})();
/* ══ End Polyfills ══ */

(() => {
  if (window.__graniteWalletInjected) return;
  window.__graniteWalletInjected = true;
  let requestId = 0;
  const pendingRequests = /* @__PURE__ */ new Map();
  class GraniteProvider {
    constructor() {
      this.isGranite = true;
      this.isMetaMask = true;
      this._events = {};
      this.chainId = null;
      this.selectedAddress = null;
      this.connected = false;
      this.networkVersion = null;
      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.target !== "granite-inpage") return;
        const { id, result, error, type, event: walletEvent } = event.data;
        if (type === "event" && walletEvent) {
          this._handleEvent(walletEvent);
          return;
        }
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
    async request(args) {
      const { method, params = [] } = args;
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        pendingRequests.set(id, { resolve, reject });
        window.postMessage(
          {
            target: "granite-content-script",
            id,
            method,
            params
          },
          "*"
        );
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`Request timeout: ${method}`));
          }
        }, 6e4);
      });
    }
    /**
     * Legacy: send method (deprecated but still used by some dApps).
     */
    send(method, params) {
      return this.request({ method, params });
    }
    /**
     * Legacy: sendAsync (used by older web3.js versions).
     */
    sendAsync(payload, callback) {
      this.request({ method: payload.method, params: payload.params }).then((result) => {
        callback(null, {
          id: payload.id,
          jsonrpc: "2.0",
          result
        });
      }).catch((err) => callback(err));
    }
    /**
     * Legacy: enable (deprecated, same as eth_requestAccounts).
     */
    async enable() {
      return this.request({ method: "eth_requestAccounts" });
    }
    // ─── Event Emitter (EIP-1193) ───
    on(event, listener) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(listener);
      return this;
    }
    removeListener(event, listener) {
      if (this._events[event]) {
        this._events[event] = this._events[event].filter((l) => l !== listener);
      }
      return this;
    }
    removeAllListeners(event) {
      if (event) {
        delete this._events[event];
      } else {
        this._events = {};
      }
      return this;
    }
    emit(event, ...args) {
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
    _handleEvent(event) {
      var _a;
      switch (event.type) {
        case "accountsChanged":
          this.selectedAddress = ((_a = event.accounts) == null ? void 0 : _a[0]) || null;
          this.emit("accountsChanged", event.accounts);
          break;
        case "chainChanged":
          this.chainId = "0x" + event.chainId.toString(16);
          this.networkVersion = event.chainId.toString();
          this.emit("chainChanged", this.chainId);
          break;
        case "connect":
          this.connected = true;
          this.emit("connect", { chainId: "0x" + event.chainId.toString(16) });
          break;
        case "disconnect":
          this.connected = false;
          this.selectedAddress = null;
          this.emit("disconnect");
          break;
      }
    }
  }
  const provider = new GraniteProvider();
  Object.defineProperty(window, "ethereum", {
    value: provider,
    writable: false,
    configurable: true
  });
  const info = {
    uuid: "granite-wallet-001",
    name: "Granite Wallet",
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23023859" width="100" height="100" rx="20"/><path d="M50 15L80 75H20Z" fill="%230367A6" opacity="0.8"/><path d="M35 30L55 75H15Z" fill="%23C4E1F2" opacity="0.6"/></svg>',
    rdns: "com.blackmountainig.granite"
  };
  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info, provider })
    })
  );
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider })
      })
    );
  });
  console.log("⛰ Granite Wallet provider injected");
})();
//# sourceMappingURL=inpage.js.map
