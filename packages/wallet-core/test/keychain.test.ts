import { describe, it, expect } from 'vitest';
import { derivePath } from 'ed25519-hd-key';
import * as nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import {
  generateMnemonic,
  validateMnemonic,
  mnemonicToSeed,
  deriveEVMKeyPair,
  deriveSolanaKeyPair,
  deriveAllChains,
} from '../src/crypto/keychain';
import { Chain } from '../src/types';

// The BIP-39 reference vector. Its first Ethereum account is published
// everywhere (MetaMask, ethers docs), so a wrong derivation shows at once.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ETH_ACCOUNT_0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const ETH_ACCOUNT_1 = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0';

describe('mnemonics', () => {
  it('generates valid 12 and 24 word phrases', () => {
    const twelve = generateMnemonic(128);
    const twentyFour = generateMnemonic(256);
    expect(twelve.split(' ')).toHaveLength(12);
    expect(twentyFour.split(' ')).toHaveLength(24);
    expect(validateMnemonic(twelve)).toBe(true);
    expect(validateMnemonic(twentyFour)).toBe(true);
    expect(twelve).not.toEqual(generateMnemonic(128));
  });

  it('rejects a phrase with a bad checksum', () => {
    expect(validateMnemonic(MNEMONIC.replace('about', 'abandon'))).toBe(false);
  });
});

describe('EVM derivation', () => {
  it('matches the reference vector on every EVM chain', () => {
    for (const chain of [Chain.ETHEREUM, Chain.POLYGON, Chain.BNB, Chain.ARBITRUM, Chain.OPTIMISM, Chain.BASE, Chain.AVALANCHE]) {
      const kp = deriveEVMKeyPair(MNEMONIC, chain, 0);
      expect(kp.address).toBe(ETH_ACCOUNT_0);
      expect(kp.derivationPath).toBe("m/44'/60'/0'/0/0");
    }
    expect(deriveEVMKeyPair(MNEMONIC, Chain.ETHEREUM, 1).address).toBe(ETH_ACCOUNT_1);
  });
});

describe('Solana derivation', () => {
  it('matches ed25519-hd-key on the Phantom path', async () => {
    const seed = await mnemonicToSeed(MNEMONIC);
    for (const index of [0, 1, 7]) {
      const ours = await deriveSolanaKeyPair(MNEMONIC, index);
      const { key } = derivePath(`m/44'/501'/${index}'/0'`, seed.toString('hex'));
      const reference = nacl.sign.keyPair.fromSeed(key);
      expect(ours.address).toBe(new PublicKey(reference.publicKey).toBase58());
      expect(ours.privateKey).toBe(Buffer.from(reference.secretKey).toString('hex'));
    }
  });
});

describe('deriveAllChains', () => {
  it('returns one account per supported chain and no Bitcoin', async () => {
    const pairs = await deriveAllChains(MNEMONIC, 0);
    const chains = pairs.map((p) => p.chain);
    expect(chains).toEqual([
      Chain.ETHEREUM, Chain.POLYGON, Chain.BNB, Chain.AVALANCHE,
      Chain.ARBITRUM, Chain.OPTIMISM, Chain.BASE, Chain.SOLANA,
    ]);
    expect(chains).not.toContain('bitcoin');
  });
});
