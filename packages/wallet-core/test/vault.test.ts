import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, verifyPassword } from '../src/crypto/encryption';
import { VaultManager, MemoryStorageBackend } from '../src/storage/vault';
import { GraniteWallet } from '../src/engine';
import { Chain } from '../src/types';

// 10k iterations keep the suite fast; the production default is 600k.
const FAST = 10_000;

describe('encryption', () => {
  it('round-trips and rejects the wrong password', async () => {
    const box = await encrypt('secret words', 'correct horse', FAST);
    expect(box.iterations).toBe(FAST);
    expect(await decrypt(box.ciphertext, box.iv, box.salt, 'correct horse', FAST)).toBe('secret words');
    await expect(decrypt(box.ciphertext, box.iv, box.salt, 'battery staple', FAST)).rejects.toThrow(/Decryption failed/);
    expect(await verifyPassword(box.ciphertext, box.iv, box.salt, 'correct horse', FAST)).toBe(true);
    expect(await verifyPassword(box.ciphertext, box.iv, box.salt, 'nope', FAST)).toBe(false);
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = await encrypt('x', 'p', FAST);
    const b = await encrypt('x', 'p', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe('vault session', () => {
  it('restores an unlocked session in a fresh VaultManager and drops it on lock', async () => {
    const storage = new MemoryStorageBackend();
    const session = new MemoryStorageBackend();
    const wallet = { id: 'w1', name: 'Main', accounts: [], createdAt: 0 };

    const first = new VaultManager(storage, session, 60_000);
    await first.createVault('password123', 'w1', 'Main', 'seed words here', [wallet]);
    expect(first.isUnlocked()).toBe(true);

    // A new service worker instance: same storage, same session.
    const second = new VaultManager(storage, session, 60_000);
    expect(second.isUnlocked()).toBe(false);
    expect(await second.restoreSession()).toBe(true);
    expect(second.getSeed('w1')).toBe('seed words here');

    second.lock();
    const third = new VaultManager(storage, session, 60_000);
    expect(await third.restoreSession()).toBe(false);
    expect(() => third.getSeed('w1')).toThrow(/locked/);
  });

  it('does not restore an expired session', async () => {
    const storage = new MemoryStorageBackend();
    const session = new MemoryStorageBackend();
    const v = new VaultManager(storage, session, 1);
    await v.createVault('password123', 'w1', 'Main', 'seed', [{ id: 'w1', name: 'Main', accounts: [], createdAt: 0 }]);
    await new Promise((r) => setTimeout(r, 5));
    const again = new VaultManager(storage, session, 1);
    expect(await again.restoreSession()).toBe(false);
  });

  it('refuses to add a wallet under a different password', async () => {
    const v = new VaultManager(new MemoryStorageBackend(), new MemoryStorageBackend());
    await v.createVault('password123', 'w1', 'Main', 'seed one', [{ id: 'w1', name: 'Main', accounts: [], createdAt: 0 }]);
    await expect(
      v.addWallet('different', 'w2', 'seed two', { id: 'w2', name: 'Two', accounts: [], createdAt: 0 })
    ).rejects.toThrow(/Wrong password/);
    expect(await v.verifyPassword('password123')).toBe(true);
  });
});

describe('GraniteWallet engine', () => {
  it('creates, locks, unlocks and exports with the password', async () => {
    const engine = new GraniteWallet(new MemoryStorageBackend(), new MemoryStorageBackend());
    await engine.init();
    const { mnemonic, wallet } = await engine.createWallet('password123', 'Main');
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(wallet.accounts.map((a) => a.chain)).toContain(Chain.SOLANA);
    expect(await engine.getAddress(Chain.ETHEREUM)).toMatch(/^0x[0-9a-fA-F]{40}$/);

    engine.lock();
    expect(engine.isUnlocked()).toBe(false);
    await expect(engine.exportMnemonic('wrong')).rejects.toThrow();
    expect(await engine.exportMnemonic('password123')).toBe(mnemonic);

    await engine.unlock('password123');
    const next = await engine.deriveNextAccount(Chain.ETHEREUM);
    expect(next.index).toBe(1);
    expect(engine.validateAddress(Chain.ETHEREUM, next.address).valid).toBe(true);
    expect(engine.validateAddress(Chain.SOLANA, 'not an address').valid).toBe(false);
  }, 30_000);

  it('keeps dApp connections and the active chain across restarts', async () => {
    const storage = new MemoryStorageBackend();
    const session = new MemoryStorageBackend();
    const a = new GraniteWallet(storage, session);
    await a.init();
    await a.createWallet('password123');
    a.setActiveChain(Chain.BASE);
    await a.connectDApp('https://app.example', 'Example');
    expect(a.isDAppConnected('https://app.example')).toBe(true);

    const b = new GraniteWallet(storage, session);
    await b.init();
    expect(b.isUnlocked()).toBe(true);
    expect(b.getActiveChain()).toBe(Chain.BASE);
    expect(b.isDAppConnected('https://app.example')).toBe(true);
    await b.disconnectDApp('https://app.example');

    const c = new GraniteWallet(storage, session);
    await c.init();
    expect(c.isDAppConnected('https://app.example')).toBe(false);
  }, 30_000);
});
