# Granite Wallet Privacy Policy

Effective 24 November 2026. Published by Black Mountain Investment Group LLC ("we"). This policy covers the Granite Wallet browser extension. The hosted copy is at https://kjniedz.github.io/granite-wallet/privacy.html and the source of this document is `PRIVACY.md` in the repository.

## The short version

Granite Wallet has no server, no account and no analytics. We do not collect, receive, store or sell any information about you. Everything the wallet knows lives in your browser's extension storage on your device.

## What the extension stores on your device

- Your seed phrase, encrypted with AES-256-GCM under a key derived from your password. We cannot decrypt it. If you lose the password and the phrase, nobody can recover the wallet.
- Wallet names and public addresses, unencrypted, so the popup can show them while locked.
- The list of websites you have connected, the network you last used, and a history of transactions you sent from the wallet.
- While unlocked, the decrypted seed phrase is held in `chrome.storage.session`, which is memory only, readable by the extension alone, and cleared when the browser exits or the wallet locks.

Removing the extension deletes all of this.

## What leaves your device, and to whom

The wallet must talk to blockchains to work. These requests are made directly from your browser; they do not pass through us.

- **RPC endpoints.** Balance reads, fee estimates and signed transactions go to public JSON-RPC endpoints operated by PublicNode (`*.publicnode.com`). They see your IP address and the addresses you query. The URLs are in `packages/wallet-core/src/chains/config.ts`; you can rebuild the extension pointing at your own provider.
- **Price lookups.** USD values come from the CoinGecko public API (`api.coingecko.com`). CoinGecko sees your IP address and the token symbols requested, never your addresses.
- **Websites you connect.** A site you approve receives your public address for the connected account and can ask you to sign messages or transactions. Every such request is shown to you first. Sites you have not connected receive nothing; the injected provider answers only with the chain ID and public chain reads until you connect.

The fonts and all other assets are bundled with the extension. The popup makes no request to Google or any other third party.

## Permissions

- `storage`: to keep the encrypted vault and settings.
- `alarms`: to lock the wallet after five minutes without use.
- Host access to `http://*/*` and `https://*/*`: to inject the `window.ethereum` provider into pages so decentralised applications can find the wallet. The content script relays requests and does nothing else. It does not read page content.

## Children

Granite Wallet is not directed at children under 13 and we do not knowingly collect information from them. We collect no information from anyone.

## Changes

If this policy changes, the new version will be published at the URL above with a new effective date, and the change will be visible in the repository history.

## Contact

hello@blackmountainig.com
