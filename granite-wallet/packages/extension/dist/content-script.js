
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

function injectProvider() {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inpage.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.error("Granite Wallet: Failed to inject provider", err);
  }
}
injectProvider();
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.target !== "granite-content-script") return;
  const { id, method, params } = event.data;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "granite_dapp_request",
      payload: {
        method,
        params,
        origin: window.location.origin
      }
    });
    window.postMessage(
      {
        target: "granite-inpage",
        id,
        result: response == null ? void 0 : response.result,
        error: response == null ? void 0 : response.error
      },
      "*"
    );
  } catch (err) {
    window.postMessage(
      {
        target: "granite-inpage",
        id,
        error: err.message || "Unknown error"
      },
      "*"
    );
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "granite_event") {
    window.postMessage(
      {
        target: "granite-inpage",
        type: "event",
        event: message.event
      },
      "*"
    );
  }
});
console.log("Granite Wallet content script loaded.");
//# sourceMappingURL=content-script.js.map
