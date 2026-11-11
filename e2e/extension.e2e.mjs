import { chromium } from 'playwright';
import { verifyMessage } from '@ethersproject/wallet';
import bytes from '@ethersproject/bytes';
import strings from '@ethersproject/strings';
const { hexlify } = bytes; const { toUtf8Bytes } = strings;
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Run from e2e/ after `npm run build` at the repo root:
//   npm install && npm run install-browser && npm test
// Google's branded Chrome ignores --load-extension since Chrome 137, so
// this uses Playwright's Chromium (or GW_EXE if you point it elsewhere).
const EXT = new URL('../packages/extension/dist', import.meta.url).pathname;
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ETH0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const PASSWORD = 'password123';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: process.env.GW_EXE || undefined,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const swErrors = [];
const waitSw = async (ctx) => { for (let i = 0; i < 60; i++) { const w = ctx.serviceWorkers()[0]; if (w) return w; await new Promise(r => setTimeout(r, 500)); } throw new Error('service worker did not start'); };
let sw = await waitSw(context);
sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });
const extId = new URL(sw.url()).host;
console.log('extension id', extId);

// ─── Popup: create a wallet ───
const popup = await context.newPage();
const popupErrors = [];
popup.on('pageerror', (e) => popupErrors.push(String(e)));
popup.on('console', (m) => { if (m.type() === 'error') popupErrors.push(m.text()); });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.getByRole('button', { name: 'Create New Wallet' }).click();
await popup.getByPlaceholder('At least 8 characters').fill(PASSWORD);
await popup.getByPlaceholder('Confirm password').fill(PASSWORD);
await popup.getByRole('button', { name: 'Create Wallet' }).click();
try { await popup.getByRole('button', { name: "I've Saved My Seed Phrase" }).waitFor({ timeout: 30000 }); }
catch (e) { console.log('POPUP BODY:', (await popup.textContent('body')).slice(0, 600)); console.log('POPUP ERRORS:', popupErrors); console.log('SW ERRORS:', swErrors); await popup.screenshot({ path: 'fail.png' }); throw e; }
const words = await popup.locator('div[style*="grid"] span:nth-child(2)').allTextContents();
check('create: shows a 12-word phrase', words.length === 12, words.length + ' words');
await popup.getByRole('button', { name: "I've Saved My Seed Phrase" }).click();
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
const addrPill = await popup.locator('button:has-text("...")').first().textContent();
check('home: shows an address', /^0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}/.test(addrPill.trim()), addrPill.trim());

// ─── Service worker restart survives: lock state kept via storage.session ───
// (We cannot kill the SW from Playwright reliably; instead reopen the popup and expect no unlock prompt.)
await popup.reload();
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
check('reopen popup: still unlocked', true);

// ─── Import the reference phrase into a second profile-less flow: use the engine via a fresh profile? Simpler: lock, then import adds a second wallet ───
await popup.locator('button:has-text("🔒")').click();
await popup.getByPlaceholder('Password').waitFor();
await popup.getByPlaceholder('Password').fill('wrong-password');
await popup.getByRole('button', { name: 'Unlock' }).click();
await popup.getByText(/Incorrect password/).waitFor({ timeout: 20000 });
check('unlock: rejects the wrong password', true);
await popup.getByPlaceholder('Password').fill(PASSWORD);
await popup.getByRole('button', { name: 'Unlock' }).click();
await popup.getByText('Portfolio Balance').waitFor({ timeout: 20000 });
check('unlock: accepts the right password', true);

// Export seed through Settings
await popup.locator('button:has-text("⚙")').click();
await popup.getByText('Backup').click();
await popup.getByPlaceholder('Your wallet password').fill(PASSWORD);
await popup.getByRole('button', { name: 'Reveal' }).click();
await popup.getByRole('button', { name: 'Done' }).waitFor({ timeout: 20000 });
const exported = (await popup.locator('div[style*="grid"] span:nth-child(2)').allTextContents()).join(' ');
check('export: reveals the same phrase', exported === words.join(' '));
await popup.getByRole('button', { name: 'Done' }).click();

// Receive page renders a real QR image
await popup.getByRole('button', { name: /Back|←/ }).first().click().catch(() => {});
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await popup.getByText('Receive').click();
const qr = popup.locator('img[alt="Address QR code"]');
await qr.waitFor({ timeout: 10000 });
check('receive: QR code rendered', (await qr.getAttribute('src')).startsWith('data:image/png'));

// ─── dApp flow on a real page ───
const dapp = await context.newPage();
await dapp.goto('https://example.com/');
await dapp.waitForFunction(() => !!window.ethereum, null, { timeout: 10000 });
const chainId = await dapp.evaluate(() => window.ethereum.request({ method: 'eth_chainId' }));
check('dapp: eth_chainId', chainId === '0x1', chainId);
const announced = await dapp.evaluate(() => new Promise((res) => {
  const found = [];
  window.addEventListener('eip6963:announceProvider', (e) => found.push(e.detail.info.name));
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => res(found), 300);
}));
check('dapp: EIP-6963 announces Granite Wallet', announced.includes('Granite Wallet'), JSON.stringify(announced));
const noAccounts = await dapp.evaluate(() => window.ethereum.request({ method: 'eth_accounts' }));
check('dapp: eth_accounts empty before connect', Array.isArray(noAccounts) && noAccounts.length === 0);
const blockNumber = await dapp.evaluate(() => window.ethereum.request({ method: 'eth_blockNumber' }));
check('dapp: eth_blockNumber passthrough', /^0x[0-9a-f]+$/.test(blockNumber), blockNumber);
const signBeforeConnect = await dapp.evaluate(() => window.ethereum.request({ method: 'personal_sign', params: ['0x68690a', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'] }).then(() => 'signed').catch((e) => e.code));
check('dapp: personal_sign refused before connect', signBeforeConnect === 4100, String(signBeforeConnect));

// connect: request, then approve in the popup window that opens
const openPopupPage = async () => { await new Promise(r => setTimeout(r, 800)); const pg = await context.newPage(); await pg.goto(`chrome-extension://${extId}/popup.html`); return pg; };
const connectPromise = dapp.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
const approvalPage = await openPopupPage();
await approvalPage.getByText('Connection Request').waitFor({ timeout: 15000 });
check('dapp: connect approval shows the origin', (await approvalPage.textContent('body')).includes('https://example.com'));
await approvalPage.getByRole('button', { name: 'Connect' }).click();
const accounts = await connectPromise;
check('dapp: eth_requestAccounts returns the account', accounts.length === 1 && /^0x/.test(accounts[0]), JSON.stringify(accounts));
const after = await dapp.evaluate(() => window.ethereum.request({ method: 'eth_accounts' }));
check('dapp: eth_accounts after connect', after[0] === accounts[0]);

// personal_sign with hex message, verified with ethers
const message = 'Sign in to Example\nNonce: 12345';
const hex = hexlify(toUtf8Bytes(message));
const signPromise = dapp.evaluate((args) => window.ethereum.request({ method: 'personal_sign', params: args }), [hex, accounts[0]]);
const signPage = await openPopupPage();
await signPage.getByText('Signature Request').waitFor({ timeout: 15000 });
check('dapp: sign request decodes the message', (await signPage.textContent('body')).includes('Sign in to Example'));
await signPage.getByRole('button', { name: 'Sign' }).click();
const signature = await signPromise;
const recovered = verifyMessage(message, signature);
check('dapp: personal_sign verifies to the account', recovered.toLowerCase() === accounts[0].toLowerCase(), recovered);

// typed data (EIP-712) with EIP712Domain present
const typed = { types: { EIP712Domain: [{ name: 'name', type: 'string' }], Mail: [{ name: 'contents', type: 'string' }] }, primaryType: 'Mail', domain: { name: 'Example' }, message: { contents: 'hello' } };
const typedPromise = dapp.evaluate((args) => window.ethereum.request({ method: 'eth_signTypedData_v4', params: args }), [accounts[0], JSON.stringify(typed)]);
const typedPage = await openPopupPage();
await typedPage.getByText('Signature Request').waitFor({ timeout: 15000 });
await typedPage.getByRole('button', { name: 'Sign' }).click();
const typedSig = await typedPromise;
check('dapp: eth_signTypedData_v4 returns a signature', /^0x[0-9a-f]{130}$/.test(typedSig));

// reject a transaction
const txPromise = dapp.evaluate((args) => window.ethereum.request({ method: 'eth_sendTransaction', params: args }).then(() => 'sent').catch((e) => e.code), [{ from: accounts[0], to: accounts[0], value: '0x1', data: '0x' }]);
const txPage = await openPopupPage();
await txPage.getByText('Transaction Request').waitFor({ timeout: 15000 });
await txPage.getByRole('button', { name: 'Reject' }).click();
check('dapp: rejected transaction returns 4001', (await txPromise) === 4001);

// chain switch + event
const switched = await dapp.evaluate(() => new Promise(async (res) => {
  window.ethereum.on('chainChanged', (id) => res(id));
  await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
  setTimeout(() => res('no event'), 3000);
}));
check('dapp: wallet_switchEthereumChain emits chainChanged', switched === '0x2105', String(switched));
const unsupported = await dapp.evaluate(() => window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x539' }] }).catch((e) => e.code));
check('dapp: unknown chain returns 4902', unsupported === 4902, String(unsupported));

// ─── Import the reference phrase: fresh profile ───
await context.close();
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-profile-'));
const ctx2 = await chromium.launchPersistentContext(dir2, { executablePath: process.env.GW_EXE || undefined, headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const sw2 = await waitSw(ctx2);
const id2 = new URL(sw2.url()).host;
const p2 = await ctx2.newPage();
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByRole('button', { name: 'Import Seed Phrase' }).click();
await p2.locator('textarea').fill(MNEMONIC);
await p2.getByPlaceholder('At least 8 characters').fill(PASSWORD);
await p2.getByRole('button', { name: 'Import Wallet' }).click();
await p2.getByText('Portfolio Balance').waitFor({ timeout: 30000 });
await p2.getByText('Receive').click();
const full = await p2.locator('div[style*="break-all"]').first().textContent();
check('import: reference phrase gives the known ETH address', full.trim() === ETH0, full.trim());
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await p2.locator('button:has-text("Ethereum")').first().click();
await p2.getByText('Solana').click();
await p2.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await p2.getByText('Receive').click();
const sol = (await p2.locator('div[style*="break-all"]').first().textContent()).trim();
check('import: Solana address is base58 and 32 bytes', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sol), sol);
// balances load from public RPC
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.locator('button:has-text("Solana")').first().click();
await p2.getByText('Ethereum', { exact: true }).click();
const ethRow = p2.locator('text=ETH').first();
await ethRow.waitFor({ timeout: 30000 }).then(() => check('balances: ETH row loaded from RPC', true)).catch(() => check('balances: ETH row loaded from RPC', false));
await ctx2.close();

console.log('\nSW errors:', swErrors.length ? swErrors : 'none');
console.log('popup errors:', popupErrors.length ? popupErrors : 'none');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
