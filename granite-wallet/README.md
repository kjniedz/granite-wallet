# ⛰ Granite Wallet & Granite Exchange

**Self-custody multi-chain wallet & decentralized exchange**
*by Black Mountain Investment Group LLC*

---

## Architecture

```
granite-wallet/
├── packages/
│   ├── wallet-core/          # Core SDK — key management, chain providers, vault
│   │   └── src/
│   │       ├── crypto/       # BIP-39/44 keychain + AES-256-GCM encryption
│   │       ├── chains/       # EVM + Solana providers, chain configs
│   │       ├── storage/      # Encrypted vault manager
│   │       ├── types/        # TypeScript type definitions
│   │       └── engine.ts     # Main GraniteWallet orchestrator
│   │
│   └── extension/            # Chrome Extension (Manifest V3)
│       ├── public/           # manifest.json, icons
│       └── src/
│           ├── background/   # Service worker — message handling, wallet state
│           ├── content/      # Content script + inpage.js (EIP-1193 provider)
│           ├── popup/        # React UI (360x600 popup)
│           └── shared/       # Typed messaging utilities
│
└── package.json              # Monorepo root
```

## Security Model

- **Self-custody**: Private keys never leave the user's device
- **Encrypted at rest**: Seed phrases encrypted with AES-256-GCM (600K PBKDF2 iterations)
- **Keys derived on-demand**: Private keys are derived from seed, used, and discarded — never stored
- **Auto-lock**: Wallet locks after 5 minutes of inactivity
- **No server dependency**: All crypto operations happen client-side

## Supported Chains

| Chain      | Type | Chain ID | Native Token |
|------------|------|----------|-------------|
| Ethereum   | EVM  | 1        | ETH         |
| Polygon    | EVM  | 137      | POL         |
| BNB Chain  | EVM  | 56       | BNB         |
| Avalanche  | EVM  | 43114    | AVAX        |
| Arbitrum   | EVM  | 42161    | ETH         |
| Optimism   | EVM  | 10       | ETH         |
| Base       | EVM  | 8453     | ETH         |
| Solana     | SVM  | —        | SOL         |
| Bitcoin    | UTXO | —        | BTC         |

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup
```bash
# Install dependencies
npm install

# Build wallet core
npm run build:core

# Build Chrome extension
npm run build:extension
```

### Load Extension in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `packages/extension/dist/`
5. Click the Granite Wallet icon in your toolbar

### Development
```bash
# Watch mode for extension (auto-rebuilds on file changes)
npm run dev:extension
```

## dApp Compatibility

Granite Wallet implements:
- **EIP-1193** — Ethereum Provider JavaScript API
- **EIP-6963** — Multi-injected Provider Discovery
- **EIP-712** — Typed structured data signing
- **personal_sign** — Message signing
- **wallet_switchEthereumChain** — Chain switching

Compatible with: Uniswap, OpenSea, Aave, Lido, 1inch, Raydium, Jupiter, and virtually all Web3 dApps.

## Granite Exchange (Phase 3)

Decentralized swap aggregation across:
- Uniswap V3 (Ethereum, Polygon, Arbitrum, Base)
- PancakeSwap (BNB Chain)
- Jupiter (Solana)
- 1inch Aggregation Protocol
- Cross-chain bridges (LayerZero, Wormhole)

All swaps are non-custodial — the user signs and broadcasts directly.

## Brand

| Color       | Hex       | Usage            |
|-------------|-----------|------------------|
| Navy        | `#023859` | Primary background |
| Blue        | `#0367A6` | Accent, CTAs     |
| Light Blue  | `#C4E1F2` | Secondary text   |
| Black       | `#070707` | Text on light    |
| Gray        | `#717171` | Muted text       |
| Light Gray  | `#F5F5F5` | Light backgrounds |

**Font**: Poppins (all weights)

---

© 2026 Black Mountain Investment Group LLC · [blackmountainig.com](https://blackmountainig.com)
