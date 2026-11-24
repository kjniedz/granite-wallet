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
//
// Besides the checks, the run writes screenshots into docs/screenshots:
// the popup alone at 2x for the README, and 1280x800 framed images for the
// Chrome Web Store listing under docs/screenshots/store. Set GW_NO_SHOTS=1
// to skip them.
const EXT = new URL('../packages/extension/dist', import.meta.url).pathname;
const SHOTS = new URL('../docs/screenshots', import.meta.url).pathname;
const TAKE_SHOTS = !process.env.GW_NO_SHOTS;
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ETH0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const PASSWORD = 'password123';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

const launch = (dir) => chromium.launchPersistentContext(dir, {
  executablePath: process.env.GW_EXE || undefined,
  headless: true,
  channel: 'chromium', // the headless shell cannot load extensions
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const waitSw = async (ctx) => { for (let i = 0; i < 60; i++) { const w = ctx.serviceWorkers()[0]; if (w) return w; await new Promise(r => setTimeout(r, 500)); } throw new Error('service worker did not start'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Screenshots ───
// The popup page is 360x600. For the store images the page is restyled so
// the popup sits in a frame with a caption; the frame lives only in the
// screenshot run and never in the extension.
const FRAME_CSS = `
html, body { width: 100vw !important; height: 100vh !important; overflow: hidden !important;
  background: radial-gradient(900px 500px at 15% 0%, #0a4a7a 0%, #011e30 55%, #010f1a 100%) !important;
  display: flex !important; align-items: center !important; justify-content: center !important; gap: 80px !important; }
#root { width: 360px !important; height: 600px !important; border-radius: 24px !important; overflow: hidden !important; flex: none !important;
  box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08) !important; }
.gw-cap { max-width: 480px; color: #fff; font-family: Poppins, system-ui, sans-serif; }
.gw-cap .brand { font-size: 12px; letter-spacing: 3px; color: #C4E1F2; margin-bottom: 22px; font-weight: 600; }
.gw-cap h1 { font-size: 46px; line-height: 1.1; font-weight: 700; margin: 0 0 18px; letter-spacing: -1px; }
.gw-cap p { font-size: 19px; color: rgba(255,255,255,.66); line-height: 1.5; margin: 0; }
`;
async function shoot(page, name, caption) {
  if (!TAKE_SHOTS) return;
  await page.evaluate(() => document.fonts?.ready);
  await sleep(250);
  const root = page.locator('#root');
  await root.screenshot({ path: path.join(SHOTS, `${name}.png`), scale: 'device' });
  if (caption) {
    await page.addStyleTag({ content: FRAME_CSS });
    await page.evaluate(({ title, sub }) => {
      const cap = document.createElement('div');
      cap.className = 'gw-cap';
      cap.innerHTML = `<div class="brand">GRANITE WALLET</div><h1></h1><p></p>`;
      cap.querySelector('h1').textContent = title;
      cap.querySelector('p').textContent = sub;
      document.body.insertBefore(cap, document.getElementById('root'));
    }, caption);
    await sleep(150);
    await page.screenshot({ path: path.join(SHOTS, 'store', `${caption.order}-${name}.png`), scale: 'css', clip: { x: 0, y: 0, width: 1280, height: 800 } });
    await page.evaluate(() => document.querySelector('.gw-cap')?.remove());
  }
}
if (TAKE_SHOTS) { fs.mkdirSync(path.join(SHOTS, 'store'), { recursive: true }); for (const f of fs.readdirSync(path.join(SHOTS, 'store'))) fs.rmSync(path.join(SHOTS, 'store', f)); }

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-profile-'));
const context = await launch(userDataDir);
const swErrors = [];
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
await popup.getByRole('button', { name: 'Create New Wallet' }).waitFor();
const fontLoaded = await popup.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 13px Poppins'); });
check('popup: bundled Poppins font loads', fontLoaded);
const externalRequests = [];
popup.on('request', (r) => { const u = r.url(); if (!u.startsWith('chrome-extension://') && !u.startsWith('data:')) externalRequests.push(u); });
await shoot(popup, 'welcome', { order: 8, title: 'Your keys. Your device. Nothing else.', sub: 'Create a wallet or import a seed phrase. There is no server, no account and no tracking.' });
await popup.getByRole('button', { name: 'Create New Wallet' }).click();
await popup.getByPlaceholder('At least 8 characters').fill(PASSWORD);
await popup.getByPlaceholder('Confirm password').fill(PASSWORD);
await popup.getByRole('button', { name: 'Create Wallet' }).click();
try { await popup.getByRole('button', { name: "I've Saved My Seed Phrase" }).waitFor({ timeout: 30000 }); }
catch (e) { console.log('POPUP BODY:', (await popup.textContent('body')).slice(0, 600)); console.log('POPUP ERRORS:', popupErrors); console.log('SW ERRORS:', swErrors); await popup.screenshot({ path: 'fail.png' }); throw e; }
const words = await popup.getByTestId('seed-word').allTextContents();
check('create: shows a 12-word phrase', words.length === 12, words.length + ' words');
check('create: continue is disabled until the backup is confirmed', await popup.getByRole('button', { name: "I've Saved My Seed Phrase" }).isDisabled());
await popup.getByRole('checkbox').check();
await popup.getByRole('button', { name: "I've Saved My Seed Phrase" }).click();
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
const addrPill = await popup.getByRole('button', { name: 'Copy address' }).textContent();
check('home: shows an address', /^0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}/.test(addrPill.trim()), addrPill.trim());
check('popup: no requests leave the extension', externalRequests.length === 0, externalRequests.join(', '));

// ─── Service worker restart survives: lock state kept via storage.session ───
// (We cannot kill the SW from Playwright reliably; instead reopen the popup and expect no unlock prompt.)
await popup.reload();
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
check('reopen popup: still unlocked', true);

// ─── Lock, wrong password, unlock ───
await popup.getByRole('button', { name: 'Lock wallet' }).click();
await popup.getByPlaceholder('Password').waitFor();
await popup.getByPlaceholder('Password').fill('wrong-password');
await popup.getByRole('button', { name: 'Unlock' }).click();
await popup.getByText(/Incorrect password/).waitFor({ timeout: 20000 });
check('unlock: rejects the wrong password', true);
await popup.getByPlaceholder('Password').fill(PASSWORD);
await popup.getByPlaceholder('Password').press('Enter');
await popup.getByText('Portfolio Balance').waitFor({ timeout: 20000 });
check('unlock: accepts the right password (Enter submits)', true);

// Export seed through Settings
await popup.getByRole('button', { name: 'Settings' }).click();
await popup.getByText('Backup').click();
await popup.getByPlaceholder('Your wallet password').fill(PASSWORD);
await popup.getByRole('button', { name: 'Reveal' }).click();
await popup.getByRole('button', { name: 'Done' }).waitFor({ timeout: 20000 });
const exported = (await popup.getByTestId('seed-word').allTextContents()).join(' ');
check('export: reveals the same phrase', exported === words.join(' '));
await popup.getByRole('button', { name: 'Done' }).click();

// Receive page renders a real QR image
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await popup.getByRole('button', { name: 'Receive' }).click();
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
const openPopupPage = async () => { await sleep(800); const pg = await context.newPage(); await pg.goto(`chrome-extension://${extId}/popup.html`); return pg; };
const connectPromise = dapp.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
const approvalPage = await openPopupPage();
await approvalPage.getByText('Connection Request').waitFor({ timeout: 15000 });
check('dapp: connect approval shows the origin', (await approvalPage.textContent('body')).includes('https://example.com'));
await shoot(approvalPage, 'connect', { order: 5, title: 'Sites connect only when you say so.', sub: 'A connected site sees your address. It cannot see your seed phrase or move funds without your approval.' });
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
await shoot(signPage, 'sign', { order: 6, title: 'Read what you sign.', sub: 'Messages are decoded and typed data is shown in full before you approve a signature.' });
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
const txPromise = dapp.evaluate((args) => window.ethereum.request({ method: 'eth_sendTransaction', params: args }).then(() => 'sent').catch((e) => e.code), [{ from: accounts[0], to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: '0x2386f26fc10000', data: '0x' }]);
const txPage = await openPopupPage();
await txPage.getByText('Transaction Request').waitFor({ timeout: 15000 });
check('dapp: transaction approval shows the amount and ticker', (await txPage.textContent('body')).includes('0.01 ETH'));
await shoot(txPage, 'transaction', { order: 7, title: 'Every transaction, on your terms.', sub: 'Amount, recipient, network and calldata are laid out before anything is signed.' });
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

// connected apps list shows the site and can revoke it
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await popup.getByRole('button', { name: 'Settings' }).click();
await popup.getByText('Connected Apps').click();
check('settings: connected apps lists example.com', (await popup.textContent('body')).includes('https://example.com'));
await popup.getByRole('button', { name: 'Revoke' }).click();
await popup.getByText('No connected sites').waitFor({ timeout: 5000 });
const afterRevoke = await dapp.evaluate(() => window.ethereum.request({ method: 'eth_accounts' }));
check('settings: revoking disconnects the site', afterRevoke.length === 0, JSON.stringify(afterRevoke));

// ─── Import the reference phrase: fresh profile ───
await context.close();
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-profile-'));
const ctx2 = await launch(dir2);
const sw2 = await waitSw(ctx2);
const id2 = new URL(sw2.url()).host;
const p2 = await ctx2.newPage();
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByRole('button', { name: 'Import Seed Phrase' }).click();
await p2.locator('textarea').fill('abandon abandon abandon');
await p2.getByPlaceholder('At least 8 characters').fill(PASSWORD);
await p2.getByRole('button', { name: 'Import Wallet' }).click();
await p2.getByText(/12 or 24 words/).waitFor({ timeout: 5000 });
check('import: rejects a phrase with the wrong word count', true);
await p2.locator('textarea').fill('  ' + MNEMONIC.toUpperCase().replace(/ /g, '   ') + '\n');
await p2.getByRole('button', { name: 'Import Wallet' }).click();
await p2.getByText('Portfolio Balance').waitFor({ timeout: 30000 });
await p2.getByRole('button', { name: 'Receive' }).click();
const full = await p2.getByTestId('full-address').textContent();
check('import: reference phrase (normalised) gives the known ETH address', full.trim() === ETH0, full.trim());
await shoot(p2, 'receive', { order: 4, title: 'Receive on any of eight networks.', sub: 'A real QR code and a one-tap copy, with a reminder of which network the address is for.' });
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await p2.getByRole('button', { name: /Change network/ }).click();
await shoot(p2, 'networks', { order: 2, title: 'One phrase. Eight chains.', sub: 'Ethereum, Polygon, BNB Chain, Avalanche, Arbitrum, Optimism, Base and Solana from the same seed.' });
await p2.getByText('Solana').click();
await p2.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await p2.getByRole('button', { name: 'Receive' }).click();
const sol = (await p2.getByTestId('full-address').textContent()).trim();
check('import: Solana address is base58 and 32 bytes', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sol), sol);
// balances load from public RPC
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByRole('button', { name: /Change network/ }).click();
await p2.getByText('Ethereum', { exact: true }).click();
const ethRow = p2.locator('text=ETH').first();
await ethRow.waitFor({ timeout: 30000 }).then(() => check('balances: ETH row loaded from RPC', true)).catch(() => check('balances: ETH row loaded from RPC', false));
await p2.getByText(/\d+ assets?/).waitFor({ timeout: 30000 }).catch(() => {});
await shoot(p2, 'home', { order: 1, title: 'Everything you hold, at a glance.', sub: 'Native coins and major tokens with live USD values, on the network you choose.' });
await p2.getByRole('button', { name: 'Send' }).click();
await p2.getByPlaceholder('0x...').fill('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
await p2.getByPlaceholder('0.0').fill('0.05');
await shoot(p2, 'send', { order: 3, title: 'Send with the fee you choose.', sub: 'Native coins and ERC-20 tokens with slow, normal and fast EIP-1559 fee tiers.' });
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await p2.getByRole('button', { name: 'Settings' }).click();
await shoot(p2, 'settings');
await p2.getByText('Security').click();
await shoot(p2, 'security');
await p2.goto(`chrome-extension://${id2}/popup.html`);
await p2.getByText('Portfolio Balance').waitFor({ timeout: 15000 });
await p2.getByRole('button', { name: 'Lock wallet' }).click();
await p2.getByPlaceholder('Password').waitFor();
await shoot(p2, 'unlock');
await ctx2.close();

console.log('\nSW errors:', swErrors.length ? swErrors : 'none');
console.log('popup errors:', popupErrors.length ? popupErrors : 'none');
if (TAKE_SHOTS) console.log('screenshots written to', SHOTS);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
