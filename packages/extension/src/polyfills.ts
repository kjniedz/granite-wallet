// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Node.js Polyfills for Browser/Extension
// Required by: bip39 (Buffer)
// ═══════════════════════════════════════════════════════════════════

import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}
