# Chrome Web Store submission

Everything the developer dashboard asks for, ready to paste. Build the package with `npm run package`; it writes `release/granite-wallet-chrome-v1.0.0.zip`.

Recommended visibility for the first submission: **Unlisted**. The listing goes through the full review, gets its permanent extension ID and auto-updates, but is reachable only by link. Switch to Public from the dashboard once the code has had an outside review; that is a toggle, not a new submission.

## Before you upload

- [ ] Developer account registered (one-time fee) and identity verified.
- [ ] Publisher shown as Black Mountain Investment Group LLC with a verified contact email on blackmountainig.com.
- [ ] GitHub Pages enabled for the repository (Settings → Pages → Deploy from branch → `main`, folder `/docs`) so the privacy policy resolves at https://kjniedz.github.io/granite-wallet/privacy.html.
- [ ] `npm run package` run from a clean checkout; the zip in `release/` is what you upload.
- [ ] Screenshots regenerated (`cd e2e && npm test` writes them to `docs/screenshots/store/`).

## Store listing

**Name:** Granite Wallet

**Summary (132 characters max):**
Self-custody wallet for Ethereum, Polygon, BNB Chain, Avalanche, Arbitrum, Optimism, Base and Solana. Your keys never leave your device.

**Category:** Productivity → Tools (Chrome has no finance category for extensions; "Tools" is where MetaMask, Phantom and Rabby sit.)

**Language:** English

**Description:**

Granite Wallet is an open-source, self-custody wallet that lives in your browser. One 12-word seed phrase gives you accounts on Ethereum, Polygon, BNB Chain, Avalanche, Arbitrum, Optimism, Base and Solana. The phrase is generated on your device, encrypted with your password, and never sent anywhere. There is no server, no account and no analytics.

WHAT YOU CAN DO
• Create a new wallet or import an existing 12 or 24 word BIP-39 phrase. Standard derivation paths mean the same words restore the same accounts in MetaMask, Phantom and hardware wallets.
• See native and major token balances with live USD values.
• Send native coins and ERC-20 tokens with slow, normal and fast EIP-1559 fee tiers.
• Receive with a real QR code and one-tap copy.
• Connect to decentralised applications. Granite injects a standard EIP-1193 provider and announces itself through EIP-6963, so any site that supports MetaMask-style wallets works. Connections, message signatures, typed-data signatures (EIP-712), transactions and network switches are all shown to you and need your approval.
• Keep a history of what you sent with links to the block explorer.

HOW YOUR KEYS ARE PROTECTED
• The seed phrase is encrypted with AES-256-GCM under a key derived from your password with PBKDF2-SHA256 at 600,000 iterations.
• Private keys are derived at signing time and discarded; they are never stored.
• The wallet locks after five minutes without use and whenever the browser closes.
• A site must be connected before it can ask for a signature, and it can only sign for the account it was connected with. The legacy eth_sign method is disabled.
• No tracking, no telemetry, no remote fonts. The only network traffic is to the blockchain RPC endpoints and to CoinGecko for prices.

OPEN SOURCE
The full source is published under the MIT license at https://github.com/kjniedz/granite-wallet. Read it, build it yourself, and report problems there. The code has not yet had an independent security audit.

Not in this version: swaps, Bitcoin, hardware wallets, custom networks and tokens, Solana dApp connections (Solana works for send and receive), and ENS names.

**Official URL:** https://kjniedz.github.io/granite-wallet/
**Homepage URL:** https://github.com/kjniedz/granite-wallet
**Support URL:** https://github.com/kjniedz/granite-wallet/issues
**Privacy policy URL:** https://kjniedz.github.io/granite-wallet/privacy.html

## Graphic assets

| Asset | Size | Source |
| --- | --- | --- |
| Store icon | 128×128 | `packages/extension/public/icons/icon-128.png` |
| Screenshots (up to 5) | 1280×800 | `docs/screenshots/store/*.png` (numbered in suggested order) |
| Small promo tile | 440×280 | not yet made; optional but shown in search results |
| Marquee promo tile | 1400×560 | optional |

## Privacy practices tab

**Single purpose description:**
Granite Wallet is a cryptocurrency wallet. It stores the user's encrypted seed phrase locally, shows balances, sends transactions, and lets websites request signatures and transactions through the standard injected provider, each with the user's explicit approval.

**Permission justifications:**

- `storage` — Holds the password-encrypted seed phrase, wallet names and public addresses, the list of connected sites, the active network and the local transaction history. Nothing is synced or sent anywhere.
- `alarms` — Schedules the automatic lock five minutes after the last interaction, so the wallet locks even while the service worker is asleep.
- Host permission `https://*/*` and `http://*/*` — The wallet must inject the `window.ethereum` provider into every page at document start so decentralised applications can discover it (EIP-1193 and EIP-6963), exactly as MetaMask, Phantom and Rabby do. The content script only relays provider requests between the page and the extension; it does not read or modify page content. `http` is included so developers can use the wallet against local test applications. A narrower match list would break dApp compatibility, since any site may host one.
- `content_scripts` on all frames — dApps frequently run the wallet connection inside an iframe (embedded widgets, checkout flows), so the provider has to exist in every frame.

**Remote code:** No. All scripts, styles and fonts are bundled in the package. The extension loads no remote JavaScript and uses no eval.

**Data usage disclosures:** Tick **none** of the data types. The developer does not collect or transmit any user data. Note for the certification: the extension itself makes network requests from the user's browser to public blockchain RPC endpoints (PublicNode) and the CoinGecko price API; those operators see the user's IP address. This is disclosed in the privacy policy. Certify that the extension does not sell data, does not use data for purposes unrelated to its single purpose, and does not use data to determine creditworthiness.

## Notes for the reviewer (Distribution → "Notes for reviewers")

No login or account is needed. To test:

1. Click the extension icon and choose Create New Wallet. Enter any password of 8 or more characters, tick the backup confirmation and continue. Alternatively choose Import Seed Phrase and use the BIP-39 reference phrase "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", which maps to the public address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94 on Ethereum.
2. The home screen shows balances fetched from public RPC endpoints. Send and Receive are reachable from there; the network can be switched with the pill at the top.
3. To test the dApp flow, open any site that supports injected wallets, for example https://app.uniswap.org, and choose Connect Wallet. Granite appears in the wallet list through EIP-6963. The connection prompt opens in the extension popup; the same happens for signature and transaction requests, all of which can be rejected without cost.
4. The injected provider is also visible in the console of any page as `window.ethereum`; `window.ethereum.request({ method: 'eth_chainId' })` returns `0x1` without connecting.

Source: https://github.com/kjniedz/granite-wallet. The uploaded zip is produced by `npm run package` at the commit tagged `v1.0.0`.

## After approval

- Add the store URL to `README.md` and `docs/index.html` in place of the build-from-source instructions.
- Tag the commit (`git tag v1.0.0`) so the uploaded zip can be reproduced.
- Each later release: bump `version` in `packages/extension/public/manifest.json` (the package.json files follow it), run `npm run package`, upload the new zip. Chrome auto-updates installed copies.
