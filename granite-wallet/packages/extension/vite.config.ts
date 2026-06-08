import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Inject polyfills as a RAW STRING at the very top of every output chunk.
 * This runs BEFORE any module initialization code.
 * 
 * Required because: bip39 → pbkdf2 → create-hmac → cipher-base → document
 * Manifest V3 service workers have no DOM at all.
 */
function polyfillBanner(): Plugin {
  const banner = `
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
`;
  return {
    name: 'polyfill-banner',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') {
          chunk.code = banner + '\n' + chunk.code;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), polyfillBanner()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        'content-script': resolve(__dirname, 'src/content/content-script.ts'),
        inpage: resolve(__dirname, 'src/content/inpage.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    minify: false,
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  resolve: {
    alias: {
      '@granite/wallet-core': resolve(__dirname, '../wallet-core/src'),
      buffer: 'buffer',
      stream: 'stream-browserify',
    },
  },
  define: {
    'process.env': JSON.stringify({}),
    'process.browser': 'true',
    'process.version': JSON.stringify(''),
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },
});
