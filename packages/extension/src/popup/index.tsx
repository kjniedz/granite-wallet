// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Popup UI
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

import '../polyfills';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import QRCodeLib from 'qrcode';
import { CHAIN_CONFIGS } from '@granite/wallet-core/chains/config';
import { api } from '../shared/messaging';

// ─── Brand Constants ───
const B = {
  navy:'#023859', blue:'#0367A6', lightBlue:'#C4E1F2',
  black:'#070707', gray:'#717171', light:'#F5F5F5',
  bg:'#011e30', card:'#02304d', green:'#4ade80', red:'#f87171',
  yellow:'#facc15', purple:'#a78bfa',
};

const CHAIN_META: Record<string,{name:string;icon:string;symbol:string;color:string}> = {
  ethereum:{name:'Ethereum',icon:'Ξ',symbol:'ETH',color:'#627eea'},
  polygon:{name:'Polygon',icon:'⬡',symbol:'POL',color:'#8247e5'},
  bnb:{name:'BNB Chain',icon:'◆',symbol:'BNB',color:'#f3ba2f'},
  avalanche:{name:'Avalanche',icon:'▲',symbol:'AVAX',color:'#e84142'},
  arbitrum:{name:'Arbitrum',icon:'◈',symbol:'ETH',color:'#28a0f0'},
  optimism:{name:'Optimism',icon:'⊕',symbol:'ETH',color:'#ff0420'},
  base:{name:'Base',icon:'◐',symbol:'ETH',color:'#0052ff'},
  solana:{name:'Solana',icon:'◎',symbol:'SOL',color:'#14f195'},
};

const VERSION = chrome.runtime?.getManifest?.().version || '1.0.0';

type Page = 'loading'|'welcome'|'create'|'import'|'backup'|'unlock'|'home'|'send'|'send_confirm'|'receive'|'history'|'settings'|'security'|'export'|'connected_apps'|'chain_selector'|'approve_connect'|'approve_tx'|'approve_sign';
type BalancesState = 'idle'|'loading'|'ready'|'error';

function explorerTxUrl(chain: string, hash?: string): string | null {
  const cfg = (CHAIN_CONFIGS as Record<string, { explorerUrl?: string }>)[chain];
  if (!cfg?.explorerUrl || !hash) return null;
  return `${cfg.explorerUrl}/tx/${hash}`;
}

function App() {
  const [page, setPage] = useState<Page>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [walletName, setWalletName] = useState('Main Wallet');
  const [mnemonic, setMnemonic] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [importPhrase, setImportPhrase] = useState('');
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{text:string;href?:string}|null>(null);

  const setErr = (e: any, fallback?: string) => {
    const msg = e?.message || fallback || 'An unexpected error occurred.';
    const detail = e?.detail || '';
    setError(msg);
    setErrorDetail(detail);
  };
  const clearErr = () => { setError(''); setErrorDetail(''); };
  const [activeWalletName, setActiveWalletName] = useState('');
  const [balances, setBalances] = useState<any[]>([]);
  const [balancesState, setBalancesState] = useState<BalancesState>('idle');
  const [activeChain, setActiveChain] = useState('ethereum');
  const [activeAddress, setActiveAddress] = useState('');
  const [txHistory, setTxHistory] = useState<any[]>([]);
  const [exportPassword, setExportPassword] = useState('');
  const [exportedPhrase, setExportedPhrase] = useState('');
  const [connectedApps, setConnectedApps] = useState<any[]>([]);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendToken, setSendToken] = useState<any>(null);
  const [sendGasEstimate, setSendGasEstimate] = useState<any>(null);
  const [sendGasSpeed, setSendGasSpeed] = useState<'slow'|'normal'|'fast'>('normal');
  const [currentApproval, setCurrentApproval] = useState<any>(null);
  const [initError, setInitError] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);

  // Retry connecting to background service worker (MV3 workers can be slow to start)
  const initWallet = useCallback(async (retries = 3): Promise<void> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const hasVault = await api.hasVault();
        const unlocked = await api.isUnlocked();
        if (!hasVault) { setPage('welcome'); return; }
        if (unlocked) {
          await loadWalletData();
          const approvals = await api.getPendingApprovals();
          if (approvals.length > 0) { showApproval(approvals[0]); return; }
          setPage('home');
        } else { setPage('unlock'); }
        return;
      } catch (err: any) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        } else {
          console.error('Wallet init failed after retries:', err);
          setInitError('Could not connect to the wallet service. Close and reopen the extension.');
          setPage('welcome');
        }
      }
    }
  }, []);

  useEffect(() => {
    initWallet();
    const listener = (msg: any) => { if (msg.type === 'granite_locked') { setPage('unlock'); setPassword(''); } };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, []);

  useEffect(() => {
    if (page !== 'home') return;
    const interval = setInterval(async () => {
      try {
        const approvals = await api.getPendingApprovals();
        if (approvals.length > 0) showApproval(approvals[0]);
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [page]);

  const showApproval = (a: any) => {
    setCurrentApproval(a);
    if (a.type === 'connect') setPage('approve_connect');
    else if (a.type === 'transaction') setPage('approve_tx');
    else setPage('approve_sign');
  };

  const showToast = (text: string, href?: string) => {
    setToast({ text, href });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), href ? 6000 : 2500);
  };

  const copyAddress = () => {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress).then(() => showToast('Address copied')).catch(() => showToast('Could not copy'));
  };

  const fetchBalances = useCallback((chain: string) => {
    setBalancesState('loading');
    api.getBalances(chain).then(b => {
      setBalances(b);
      setBalancesState('ready');
      setSendToken((cur: any) => cur ?? b[0]?.token ?? null);
    }).catch(err => { console.warn('Balances failed:', err); setBalancesState('error'); });
  }, []);

  const loadWalletData = useCallback(async () => {
    try {
      api.getActiveWallet().then(w => setActiveWalletName(w?.name || '')).catch(() => {});
      const chain = await api.getActiveChain(); setActiveChain(chain);
      const addr = await api.getAddress(chain); setActiveAddress(addr || '');
      fetchBalances(chain);
      api.getConnectedDApps().then(setConnectedApps).catch(() => {});
      api.getTransactionHistory().then(setTxHistory).catch(() => {});
    } catch (err) { console.warn('Load failed:', err); }
  }, [fetchBalances]);

  const handleCreate = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true); clearErr();
    try { const r = await api.createWallet(password, walletName.trim() || 'Main Wallet'); setMnemonic(r.mnemonic); setBackupConfirmed(false); setPage('backup'); }
    catch (e: any) { setErr(e, 'Failed to create wallet.'); } finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    const phrase = importPhrase.trim().toLowerCase().split(/\s+/).join(' ');
    const n = phrase ? phrase.split(' ').length : 0;
    if (!phrase) { setError('Enter your seed phrase.'); return; }
    if (n !== 12 && n !== 24) { setError(`A seed phrase has 12 or 24 words. You entered ${n}.`); return; }
    setLoading(true); clearErr();
    try { await api.importWallet(password, walletName.trim() || 'Imported Wallet', phrase); setImportPhrase(''); await loadWalletData(); setPage('home'); }
    catch (e: any) { setErr(e, 'Failed to import wallet.'); } finally { setLoading(false); }
  };

  const handleUnlock = async () => {
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true); clearErr();
    try {
      await api.unlock(password); await loadWalletData(); setPassword('');
      const approvals = await api.getPendingApprovals();
      if (approvals.length > 0) showApproval(approvals[0]); else setPage('home');
    } catch (e: any) { setErr(e, 'Incorrect password. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleLock = async () => { await api.lock(); setPassword(''); clearErr(); setPage('unlock'); };
  const handleBackupDone = async () => { setMnemonic(''); setPassword(''); setConfirmPassword(''); await loadWalletData(); setPage('home'); };

  const handleSwitchChain = async (chain: string) => {
    await api.setActiveChain(chain); setActiveChain(chain);
    const addr = await api.getAddress(chain); setActiveAddress(addr || '');
    setBalances([]); setSendToken(null); setPage('home');
    fetchBalances(chain);
  };

  const handleExport = async () => {
    if (!exportPassword) { setError('Enter your password to reveal the seed phrase.'); return; }
    setLoading(true); clearErr();
    try { setExportedPhrase(await api.exportMnemonic(exportPassword)); }
    catch (e: any) { setErr(e, 'Incorrect password.'); } finally { setLoading(false); setExportPassword(''); }
  };
  const leaveExport = () => { setExportedPhrase(''); setExportPassword(''); clearErr(); setPage('settings'); };

  const handleSendPreview = async () => {
    if (!sendTo || !sendAmount) { setError('Enter a recipient address and an amount.'); return; }
    if (!(parseFloat(sendAmount) > 0)) { setError('Enter an amount greater than zero.'); return; }
    setLoading(true); clearErr();
    try {
      const v = await api.validateAddress(activeChain, sendTo.trim());
      if (!v.valid) { setError(v.error || 'That address is not valid on this network.'); setLoading(false); return; }
      const gas = await api.estimateGas({ chain: activeChain, from: activeAddress, to: sendTo.trim(), value: sendAmount, token: sendToken?.address ? sendToken : undefined });
      setSendGasEstimate(gas); setPage('send_confirm');
    } catch (e: any) { setErr(e, 'Could not estimate the network fee.'); }
    finally { setLoading(false); }
  };

  const handleSendConfirm = async () => {
    setLoading(true); clearErr();
    try {
      const gs = sendGasEstimate?.[sendGasSpeed] || {};
      const txHash = await api.sendTransaction({ chain: activeChain, from: activeAddress, to: sendTo.trim(), value: sendAmount, token: sendToken?.address ? sendToken : undefined, maxFeePerGas: gs.maxFeePerGas, maxPriorityFeePerGas: gs.maxPriorityFeePerGas });
      showToast('Sent. View on explorer', explorerTxUrl(activeChain, txHash) || undefined);
      setSendTo(''); setSendAmount(''); setSendGasEstimate(null); setPage('home'); loadWalletData();
    } catch (e: any) { setErr(e, 'Transaction failed.'); }
    finally { setLoading(false); }
  };

  const handleApprove = async () => {
    if (!currentApproval) return; setLoading(true); clearErr();
    try { await api.approveRequest(currentApproval.id); showToast('Approved'); setCurrentApproval(null); setPage('home'); loadWalletData(); }
    catch (e: any) { setErr(e); } finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!currentApproval) return;
    try { await api.rejectRequest(currentApproval.id, 'User rejected'); } catch {}
    setCurrentApproval(null); setPage('home');
  };

  const totalBalance = balances.reduce((s, b) => s + (b.usdValue || 0), 0);
  const shortAddr = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : '';
  const chainInfo = CHAIN_META[activeChain] || { name: activeChain, icon: '?', symbol: '?', color: '#fff' };

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {toast && (
        <div style={S.toast} role="status">
          {toast.href ? <a href={toast.href} target="_blank" rel="noreferrer" style={{color:B.black,textDecoration:'underline'}}>{toast.text}</a> : toast.text}
        </div>
      )}

      {page === 'loading' && <Center><Loader /><Muted mt={12}>Connecting to wallet...</Muted>{initError && <div style={{marginTop:12}}><Err>{initError}</Err></div>}</Center>}

      {page === 'welcome' && (
        <Center>
          <MountainIcon size={56} />
          <h1 style={{fontSize:22,fontWeight:700,margin:'16px 0 4px'}}>Granite Wallet</h1>
          <Muted mt={0} style={{letterSpacing:2,fontSize:10,marginBottom:32}}>BLACK MOUNTAIN INVESTMENT GROUP</Muted>
          {initError && <div style={{marginBottom:16,width:'100%'}}><Err>{initError}</Err></div>}
          <Muted mt={0} style={{textAlign:'center',maxWidth:280,marginBottom:32,lineHeight:1.6,fontSize:13}}>A self-custody wallet for eight chains. Your keys stay on this device and every action needs your approval.</Muted>
          <Btn onClick={()=>{setPage('create');clearErr();setInitError('')}} full>Create New Wallet</Btn>
          <div style={{height:10}} />
          <Btn onClick={()=>{setPage('import');clearErr();setInitError('')}} full secondary>Import Seed Phrase</Btn>
        </Center>
      )}

      {page === 'create' && (
        <PgWrap title="Create Wallet" onBack={()=>{setPage('welcome');clearErr()}}>
          <Input label="Wallet Name" value={walletName} set={setWalletName} ph="Main Wallet" />
          <Input label="Password" value={password} set={setPassword} type="password" ph="At least 8 characters" autoFocus />
          <Input label="Confirm Password" value={confirmPassword} set={setConfirmPassword} type="password" ph="Confirm password" onKey={(e:any)=>e.key==='Enter'&&handleCreate()} />
          <Muted mt={0} style={{fontSize:11,lineHeight:1.5}}>The password encrypts your seed phrase on this device. It cannot be reset; if you forget it, you will need the seed phrase to recover the wallet.</Muted>
          {error && <div style={{marginTop:10}}><Err detail={errorDetail}>{error}</Err></div>}
          <div style={{flex:1}} />
          <Btn onClick={handleCreate} full disabled={loading}>{loading ? 'Creating...' : 'Create Wallet'}</Btn>
        </PgWrap>
      )}

      {page === 'import' && (
        <PgWrap title="Import Wallet" onBack={()=>{setPage('welcome');clearErr()}}>
          <Input label="Wallet Name" value={walletName} set={setWalletName} ph="Imported Wallet" />
          <div style={{marginBottom:12}}>
            <label style={S.label} htmlFor="seed-phrase">Seed Phrase</label>
            <textarea id="seed-phrase" value={importPhrase} onChange={e=>setImportPhrase(e.target.value)} placeholder="Enter your 12 or 24 word seed phrase, separated by spaces" rows={3} style={S.textarea} autoComplete="off" spellCheck={false} />
          </div>
          <Input label="Password" value={password} set={setPassword} type="password" ph="At least 8 characters" onKey={(e:any)=>e.key==='Enter'&&handleImport()} />
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <Btn onClick={handleImport} full disabled={loading}>{loading ? 'Importing...' : 'Import Wallet'}</Btn>
        </PgWrap>
      )}

      {page === 'backup' && (
        <PgWrap title="Back Up Your Seed Phrase">
          <Warn title="Write these words down, in order" text="They are the only way to recover your wallet. Keep them offline and never share them." />
          <SeedGrid phrase={mnemonic} />
          <label style={S.checkRow}>
            <input type="checkbox" checked={backupConfirmed} onChange={e=>setBackupConfirmed(e.target.checked)} style={{width:16,height:16,accentColor:B.blue,flexShrink:0}} />
            <span style={{fontSize:12,color:'#ffffffb0',lineHeight:1.5}}>I have written down all {mnemonic.split(' ').length} words and understand that nobody can recover them for me.</span>
          </label>
          <div style={{flex:1}} />
          <Btn onClick={handleBackupDone} full disabled={!backupConfirmed}>I've Saved My Seed Phrase</Btn>
        </PgWrap>
      )}

      {page === 'unlock' && (
        <Center>
          <MountainIcon size={48} />
          <h2 style={{fontSize:18,fontWeight:700,margin:'16px 0 4px'}}>Welcome Back</h2>
          <Muted mt={0} style={{marginBottom:24}}>Enter your password to unlock</Muted>
          <div style={{width:'100%',maxWidth:280}}>
            <Input value={password} set={setPassword} type="password" ph="Password" autoFocus onKey={(e:any)=>e.key==='Enter'&&handleUnlock()} />
            {error && <Err detail={errorDetail}>{error}</Err>}
            <div style={{height:12}} />
            <Btn onClick={handleUnlock} full disabled={loading}>{loading ? 'Unlocking...' : 'Unlock'}</Btn>
          </div>
        </Center>
      )}

      {/* ═══ HOME ═══ */}
      {page === 'home' && (
        <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
          <div style={{padding:'14px 16px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}><MountainIcon size={18} /><span style={{fontSize:13,fontWeight:600}}>{activeWalletName || 'Granite'}</span></div>
            <div style={{display:'flex',gap:2}}>
              <IBtn label="Activity" onClick={()=>setPage('history')}><Icon.History /></IBtn>
              <IBtn label="Lock wallet" onClick={handleLock}><Icon.Lock /></IBtn>
              <IBtn label="Settings" onClick={()=>setPage('settings')}><Icon.Settings /></IBtn>
            </div>
          </div>
          <div style={{padding:'10px 16px 0'}}>
            <button onClick={()=>setPage('chain_selector')} style={{...S.chainPill,borderColor:chainInfo.color+'40'}} aria-label={`Network: ${chainInfo.name}. Change network`}>
              <span style={{fontSize:14,color:chainInfo.color}}>{chainInfo.icon}</span><span style={{fontSize:12,fontWeight:500}}>{chainInfo.name}</span><Icon.Chevron />
            </button>
          </div>
          <div style={{padding:'8px 16px'}}>
            <button onClick={copyAddress} style={S.addrPill} aria-label="Copy address" title={activeAddress}>
              <span style={{width:6,height:6,borderRadius:'50%',background:B.green}} />{shortAddr||'No address'}<Icon.Copy />
            </button>
          </div>
          <div style={{textAlign:'center',padding:'4px 16px 16px'}}>
            <div style={{fontSize:34,fontWeight:700,letterSpacing:-1}}>${totalBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <Muted mt={2}>Portfolio Balance</Muted>
          </div>
          <div style={{display:'flex',justifyContent:'center',gap:12,padding:'0 16px 14px'}}>
            <button onClick={()=>{clearErr();setPage('send')}} style={S.actionBtn} className="gw-action"><Icon.ArrowUpRight /><span style={{fontSize:11,color:B.lightBlue}}>Send</span></button>
            <button onClick={()=>setPage('receive')} style={S.actionBtn} className="gw-action"><Icon.ArrowDownLeft /><span style={{fontSize:11,color:B.lightBlue}}>Receive</span></button>
          </div>
          <div style={{flex:1,overflow:'auto',padding:'0 10px 10px'}}>
            <Card>
              <div style={{padding:'10px 14px',borderBottom:'1px solid #ffffff08',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Tokens</span>
                {balancesState==='ready' ? <Muted mt={0}>{balances.length} {balances.length===1?'asset':'assets'}</Muted>
                 : <button onClick={()=>fetchBalances(activeChain)} disabled={balancesState==='loading'} style={S.linkBtn} aria-label="Refresh balances">{balancesState==='loading'?'Refreshing...':'Refresh'}</button>}
              </div>
              {balancesState==='loading' && balances.length===0 && <div style={{padding:28,textAlign:'center'}}><Loader /><Muted mt={8}>Loading balances...</Muted></div>}
              {balancesState==='error' && <div style={{padding:'20px 16px',textAlign:'center'}}><Muted mt={0} style={{color:'#fca5a5'}}>Could not reach the {chainInfo.name} network.</Muted><Muted mt={4} style={{fontSize:11}}>Check your connection and try again.</Muted><div style={{height:10}} /><Btn onClick={()=>fetchBalances(activeChain)} secondary style={{padding:'8px 16px',fontSize:12}}>Retry</Btn></div>}
              {balancesState==='ready' && balances.length===0 && <div style={{padding:'24px 16px',textAlign:'center'}}><Muted mt={0}>No assets on {chainInfo.name} yet.</Muted><Muted mt={4} style={{fontSize:11}}>Use Receive to get your address.</Muted></div>}
              {balances.map((b,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',borderBottom:i<balances.length-1?'1px solid #ffffff05':'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <TIcon s={b.token.symbol} />
                    <div><div style={{fontSize:13,fontWeight:600}}>{b.token.symbol||'?'}</div><Muted mt={0} style={{fontSize:10}}>{b.token.name}</Muted></div>
                  </div>
                  <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:600}}>{fmtAmount(b.balanceFormatted)}</div><Muted mt={0} style={{fontSize:10}}>{b.usdValue!=null?`$${(b.usdValue||0).toFixed(2)}`:'—'}</Muted></div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}

      {/* ═══ CHAIN SELECTOR ═══ */}
      {page === 'chain_selector' && (
        <PgWrap title="Select Network" onBack={()=>setPage('home')}>
          <div style={{flex:1,overflow:'auto',margin:'0 -4px'}}>
          {Object.entries(CHAIN_META).map(([k,m])=>(
            <button key={k} onClick={()=>handleSwitchChain(k)} className="gw-row" aria-current={activeChain===k} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 8px',width:'100%',background:activeChain===k?B.blue+'20':'transparent',border:'none',color:'#fff',fontFamily:'inherit',cursor:'pointer',borderRadius:10,marginBottom:2}}>
              <span style={{fontSize:20,width:32,textAlign:'center',color:m.color}}>{m.icon}</span>
              <div style={{flex:1,textAlign:'left'}}><div style={{fontSize:13,fontWeight:600}}>{m.name}</div><Muted mt={0} style={{fontSize:11}}>{m.symbol}</Muted></div>
              {activeChain===k && <Icon.Check color={B.green} />}
            </button>
          ))}
          </div>
        </PgWrap>
      )}

      {/* ═══ SEND ═══ */}
      {page === 'send' && (
        <PgWrap title="Send" onBack={()=>{setPage('home');clearErr()}}>
          <label style={S.label}>Token</label>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
            {balances.length===0 && <Muted mt={0} style={{fontSize:11}}>{balancesState==='loading'?'Loading tokens...':`No tokens on ${chainInfo.name}.`}</Muted>}
            {balances.map((b,i)=>(<button key={i} onClick={()=>setSendToken(b.token)} aria-pressed={sendToken?.symbol===b.token.symbol} style={{...S.chip,background:sendToken?.symbol===b.token.symbol?B.blue+'30':'#ffffff08',borderColor:sendToken?.symbol===b.token.symbol?B.blue:'#ffffff15'}}>{b.token.symbol}</button>))}
          </div>
          <Input label="Recipient Address" value={sendTo} set={setSendTo} ph={activeChain==='solana'?'Solana address':'0x...'} autoFocus />
          <Input label={`Amount${sendToken?.symbol?` (${sendToken.symbol})`:''}`} value={sendAmount} set={setSendAmount} ph="0.0" type="number" onKey={(e:any)=>e.key==='Enter'&&handleSendPreview()} />
          {sendToken && (()=>{const bal=balances.find((b:any)=>b.token.symbol===sendToken.symbol);const mx=parseFloat(bal?.balanceFormatted||'0');return(
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><Muted mt={0} style={{fontSize:11}}>Available</Muted><Muted mt={0} style={{fontSize:11,color:'#fff'}}>{fmtAmount(bal?.balanceFormatted)} {sendToken.symbol}</Muted></div>
              <div style={{display:'flex',gap:6}}>{[25,50,75,100].map(p=><button key={p} onClick={()=>setSendAmount(trimZeros((mx*p/100).toFixed(6)))} style={{...S.chip,flex:1,textAlign:'center'}}>{p===100?'Max':`${p}%`}</button>)}</div>
              {!sendToken.address && <Muted mt={6} style={{fontSize:10,lineHeight:1.4}}>Sending the full {sendToken.symbol} balance leaves nothing for the network fee.</Muted>}
            </div>
          );})()}
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <Btn onClick={handleSendPreview} full disabled={loading||!sendTo||!sendAmount||!sendToken}>{loading?'Estimating fee...':'Preview Transaction'}</Btn>
        </PgWrap>
      )}

      {/* ═══ SEND CONFIRM ═══ */}
      {page === 'send_confirm' && (
        <PgWrap title="Confirm Send" onBack={()=>{setPage('send');clearErr()}}>
          <Card><div style={{padding:16,textAlign:'center'}}><div style={{fontSize:28,fontWeight:700,marginBottom:4}}>{sendAmount} {sendToken?.symbol}</div><Muted mt={0}>on {chainInfo.name}</Muted></div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="To" v={sendTo.trim()} mono />
            <DRow l="From" v={shortAddr} mono />
            <DRow l="Network" v={chainInfo.name} />
            {sendGasEstimate && <>
              <div style={{padding:'8px 14px',borderTop:'1px solid #ffffff08'}}>
                <label style={{...S.label,marginBottom:6}}>Network fee</label>
                <div style={{display:'flex',gap:6}}>
                  {(['slow','normal','fast'] as const).map(sp=>(<button key={sp} onClick={()=>setSendGasSpeed(sp)} aria-pressed={sendGasSpeed===sp} style={{...S.chip,flex:1,textAlign:'center',background:sendGasSpeed===sp?B.blue+'30':'#ffffff08',borderColor:sendGasSpeed===sp?B.blue:'#ffffff15'}}><div style={{fontSize:11,fontWeight:600,textTransform:'capitalize'}}>{sp}</div>{sendGasEstimate[sp]?.estimatedSeconds!=null && <div style={{fontSize:9,color:'#ffffff50'}}>~{sendGasEstimate[sp].estimatedSeconds}s</div>}</button>))}
                </div>
              </div>
              <DRow l="Estimated fee" v={sendGasEstimate.estimatedCostUsd!=null?`~$${Number(sendGasEstimate.estimatedCostUsd).toFixed(4)}`:'—'} />
            </>}
          </Card>
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={()=>{setPage('send');clearErr()}} secondary style={{flex:1}}>Cancel</Btn>
            <Btn onClick={handleSendConfirm} disabled={loading} style={{flex:2}}>{loading?'Sending...':'Confirm & Send'}</Btn>
          </div>
        </PgWrap>
      )}

      {/* ═══ RECEIVE ═══ */}
      {page === 'receive' && (
        <PgWrap title="Receive" onBack={()=>setPage('home')}>
          <Card><div style={{padding:20,textAlign:'center'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:16}}><span style={{fontSize:16,color:chainInfo.color}}>{chainInfo.icon}</span><span style={{fontSize:14,fontWeight:600}}>{chainInfo.name}</span></div>
            <div style={{background:'#fff',borderRadius:12,padding:12,display:'inline-block',marginBottom:16}}><QRCode data={activeAddress} size={176} /></div>
            <div data-testid="full-address" style={{fontSize:11,wordBreak:'break-all',color:'#ffffff90',lineHeight:1.6,padding:'0 8px',fontFamily:'ui-monospace, Menlo, monospace'}}>{activeAddress}</div>
          </div></Card>
          <div style={{height:12}} />
          <Btn onClick={copyAddress} full>Copy Address</Btn>
          <Warn tone="info" title={`${chainInfo.name} only`} text={`Send only ${chainInfo.symbol} and tokens on ${chainInfo.name} to this address. Assets sent on another network cannot be recovered.`} />
        </PgWrap>
      )}

      {/* ═══ HISTORY ═══ */}
      {page === 'history' && (
        <PgWrap title="Activity" onBack={()=>setPage('home')}>
          {txHistory.length === 0 ? (
            <Center style={{flex:1,opacity:0.6}}><Icon.History size={32} /><Muted mt={10}>No transactions yet</Muted><Muted mt={2} style={{fontSize:11}}>Transactions you send from this wallet appear here.</Muted></Center>
          ) : (
            <div style={{flex:1,overflow:'auto',margin:'0 -4px'}}>
            {txHistory.map((tx,i)=>{
              const url = explorerTxUrl(tx.chain, tx.hash);
              const meta = CHAIN_META[tx.chain];
              const sent = tx.direction==='sent';
              const inner = (<>
                <span style={{width:30,height:30,borderRadius:'50%',background:(sent?B.red:B.green)+'20',display:'flex',alignItems:'center',justifyContent:'center',color:sent?B.red:B.green,flexShrink:0}}>{sent?<Icon.ArrowUpRight size={14}/>:<Icon.ArrowDownLeft size={14}/>}</span>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600}}>{sent?'Sent':'Received'} {tx.token?.symbol||meta?.symbol||''}</div><Muted mt={0} style={{fontSize:10}}>{new Date(tx.timestamp).toLocaleString()}{meta?` · ${meta.name}`:''}</Muted></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:600,color:sent?B.red:B.green}}>{sent?'-':'+'}{fmtAmount(tx.value)}</div><Muted mt={0} style={{fontSize:10,color:tx.status==='failed'?B.red:tx.status==='pending'?B.yellow:'#ffffff60'}}>{cap(tx.status)}{url?' · Explorer ↗':''}</Muted></div>
              </>);
              const style: React.CSSProperties = {display:'flex',alignItems:'center',gap:12,padding:'11px 8px',borderBottom:'1px solid #ffffff08',color:'#fff',textDecoration:'none',width:'100%',background:'none',border:'none',borderRadius:8,fontFamily:'inherit',textAlign:'left'};
              return url ? <a key={i} href={url} target="_blank" rel="noreferrer" className="gw-row" style={style}>{inner}</a> : <div key={i} style={style}>{inner}</div>;
            })}
            </div>
          )}
        </PgWrap>
      )}

      {/* ═══ SETTINGS ═══ */}
      {page === 'settings' && (
        <PgWrap title="Settings" onBack={()=>setPage('home')}>
          <SItem icon={<Icon.Globe />} l="Connected Apps" d={connectedApps.length===0?'No sites connected':`${connectedApps.length} ${connectedApps.length===1?'site':'sites'} connected`} onClick={()=>setPage('connected_apps')} />
          <SItem icon={<Icon.Link />} l="Network" d={`${chainInfo.name} · change the active network`} onClick={()=>setPage('chain_selector')} />
          <SItem icon={<Icon.Shield />} l="Security" d="How your keys are protected" onClick={()=>setPage('security')} />
          <SItem icon={<Icon.Key />} l="Backup" d="Reveal seed phrase" onClick={()=>{clearErr();setPage('export')}} />
          <SItem icon={<Icon.Info />} l="About" d={`Granite Wallet ${VERSION} · Black Mountain Investment Group`} href="https://github.com/kjniedz/granite-wallet" />
          <div style={{flex:1}} />
          <Btn onClick={handleLock} full secondary>Lock Wallet</Btn>
        </PgWrap>
      )}

      {page === 'security' && (
        <PgWrap title="Security" onBack={()=>setPage('settings')}>
          <div style={{flex:1,overflow:'auto'}}>
          {[
            ['Self-custody','Your seed phrase is generated on this device and never leaves it. Nobody at Black Mountain can see it or recover it for you.'],
            ['Encrypted at rest','The seed phrase is encrypted with AES-256-GCM. The key comes from your password through 600,000 rounds of PBKDF2.'],
            ['Auto-lock','The wallet locks after 5 minutes without use and whenever the browser closes. Unlocked keys are held in memory only.'],
            ['Every action is approved','Sites can only see your address once you connect them, and every signature and transaction is shown to you before it happens.'],
            ['No tracking','There is no server, no account and no analytics. The only network traffic is to the blockchain RPC endpoints and to CoinGecko for prices.'],
            ['Open source','The full source is public under the MIT license. Review it, build it yourself, or report a problem on GitHub.'],
          ].map(([t,d],i)=>(<Card key={i} style={{marginBottom:8}}><div style={{padding:12}}><div style={{fontSize:12,fontWeight:600,marginBottom:3}}>{t}</div><Muted mt={0} style={{fontSize:11,lineHeight:1.5}}>{d}</Muted></div></Card>))}
          </div>
        </PgWrap>
      )}

      {page === 'export' && (
        <PgWrap title="Reveal Seed Phrase" onBack={leaveExport}>
          <Warn title="Anyone with these words controls your funds" text="Never enter them on a website, never share them with support, and never store them in a screenshot or cloud note." />
          {!exportedPhrase ? (<>
            <div style={{height:12}} />
            <Input label="Password" value={exportPassword} set={setExportPassword} type="password" ph="Your wallet password" autoFocus onKey={(e:any)=>e.key==='Enter'&&handleExport()} />
            {error && <Err detail={errorDetail}>{error}</Err>}
            <div style={{flex:1}} />
            <Btn onClick={handleExport} full disabled={loading||!exportPassword}>{loading?'Checking...':'Reveal'}</Btn>
          </>) : (<>
            <div style={{height:12}} />
            <SeedGrid phrase={exportedPhrase} />
            <div style={{flex:1}} />
            <Btn onClick={leaveExport} full>Done</Btn>
          </>)}
        </PgWrap>
      )}

      {page === 'connected_apps' && (
        <PgWrap title="Connected Apps" onBack={()=>setPage('settings')}>
          {connectedApps.length === 0 ? (
            <Center style={{flex:1,opacity:0.6}}><Icon.Globe size={32} /><Muted mt={10}>No connected sites</Muted><Muted mt={2} style={{fontSize:11,textAlign:'center'}}>Sites you approve will appear here. You can revoke them any time.</Muted></Center>
          ) : connectedApps.map((app,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 4px',borderBottom:'1px solid #ffffff08'}}>
              <span style={{color:B.lightBlue,display:'flex'}}><Icon.Globe /></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{app.name||app.origin}</div><Muted mt={0} style={{fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{app.origin}</Muted></div>
              <button onClick={async()=>{await api.disconnectDApp(app.origin);setConnectedApps(p=>p.filter(a=>a.origin!==app.origin));showToast('Disconnected');}} style={{...S.chip,color:B.red,borderColor:B.red+'40',fontSize:11}}>Revoke</button>
            </div>
          ))}
        </PgWrap>
      )}

      {/* ═══ APPROVE: CONNECT ═══ */}
      {page === 'approve_connect' && currentApproval && (
        <div style={{display:'flex',flexDirection:'column',height:'100%',padding:20}}>
          <div style={{textAlign:'center',marginBottom:16}}>
            <MountainIcon size={32} />
            <h2 style={{fontSize:16,fontWeight:700,margin:'12px 0 4px'}}>Connection Request</h2>
            <Muted mt={0}>A site wants to connect to your wallet</Muted>
          </div>
          <Card><div style={{padding:20,textAlign:'center'}}>
            {currentApproval.data.favicon && <img src={currentApproval.data.favicon} style={{width:40,height:40,borderRadius:10,marginBottom:10}} alt="" />}
            <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{currentApproval.data.siteName||'Unknown site'}</div>
            <Muted mt={0} style={{wordBreak:'break-all'}}>{currentApproval.data.origin}</Muted>
          </div></Card>
          <div style={{height:12}} />
          <Card><div style={{padding:14}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>This site will be able to</div>
            {['See your address and balance','Ask you to approve transactions','Ask you to sign messages'].map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}><Icon.Check color={B.green} size={13} /><Muted mt={0} style={{fontSize:12}}>{p}</Muted></div>
            ))}
            <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}><Icon.X color={B.red} size={13} /><Muted mt={0} style={{fontSize:12}}>It cannot see your seed phrase or move funds without your approval</Muted></div>
          </div></Card>
          <div style={{flex:1}} />
          <div style={{display:'flex',gap:8}}><Btn onClick={handleReject} secondary style={{flex:1}}>Reject</Btn><Btn onClick={handleApprove} disabled={loading} style={{flex:2}}>{loading?'Connecting...':'Connect'}</Btn></div>
        </div>
      )}

      {/* ═══ APPROVE: TRANSACTION ═══ */}
      {page === 'approve_tx' && currentApproval && (
        <div style={{display:'flex',flexDirection:'column',height:'100%',padding:20}}>
          <div style={{textAlign:'center',marginBottom:16}}>
            <MountainIcon size={32} />
            <h2 style={{fontSize:16,fontWeight:700,margin:'12px 0 4px'}}>Transaction Request</h2>
            <Muted mt={0}>{currentApproval.data.siteName||currentApproval.data.origin}</Muted>
          </div>
          <Card><div style={{padding:16,textAlign:'center'}}>
            <div style={{fontSize:26,fontWeight:700,marginBottom:4}}>{fmtVal(currentApproval.data.value)} {currentApproval.data.chainSymbol||chainInfo.symbol}</div>
            <Muted mt={0}>on {currentApproval.data.chainName||chainInfo.name}</Muted>
          </div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="From" v={currentApproval.data.from||''} mono />
            <DRow l="To" v={currentApproval.data.to||''} mono />
            <DRow l="Network" v={currentApproval.data.chainName||chainInfo.name} />
            {currentApproval.data.data && currentApproval.data.data!=='0x' && <DRow l="Contract call" v={`${((currentApproval.data.data.length-2)/2)} bytes of data`} vc={B.yellow} />}
            <DRow l="Site" v={currentApproval.data.origin} />
          </Card>
          {currentApproval.data.data && currentApproval.data.data!=='0x' && <Warn title="Contract interaction" text="This transaction calls a contract. Only approve it if you trust this site and understand what it does." />}
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <div style={{display:'flex',gap:8}}><Btn onClick={handleReject} secondary style={{flex:1}}>Reject</Btn><Btn onClick={handleApprove} disabled={loading} style={{flex:2}}>{loading?'Confirming...':'Approve'}</Btn></div>
        </div>
      )}

      {/* ═══ APPROVE: SIGN ═══ */}
      {page === 'approve_sign' && currentApproval && (
        <div style={{display:'flex',flexDirection:'column',height:'100%',padding:20}}>
          <div style={{textAlign:'center',marginBottom:16}}>
            <MountainIcon size={32} />
            <h2 style={{fontSize:16,fontWeight:700,margin:'12px 0 4px'}}>Signature Request</h2>
            <Muted mt={0}>{currentApproval.data.siteName||currentApproval.data.origin}</Muted>
          </div>
          <Card><div style={{padding:14}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:6}}>{currentApproval.type==='sign_typed_data'?'Typed data (EIP-712)':'Message'}</div>
            <pre style={{background:'#ffffff06',borderRadius:8,padding:10,fontSize:11,color:'#ffffff90',whiteSpace:'pre-wrap',wordBreak:'break-all',maxHeight:150,overflow:'auto',lineHeight:1.5,fontFamily:'ui-monospace, Menlo, monospace',margin:0}}>
              {currentApproval.type==='sign_typed_data'?JSON.stringify(currentApproval.data.typedData,null,2):decMsg(currentApproval.data.message||'')}
            </pre>
          </div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="Account" v={currentApproval.data.address||''} mono />
            <DRow l="Site" v={currentApproval.data.origin} />
          </Card>
          <Warn tone="info" title="Signing does not send a transaction" text="It proves you control this account. Some signatures can still authorise token transfers, so read the message before you sign." />
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <div style={{display:'flex',gap:8}}><Btn onClick={handleReject} secondary style={{flex:1}}>Reject</Btn><Btn onClick={handleApprove} disabled={loading} style={{flex:2}}>{loading?'Signing...':'Sign'}</Btn></div>
        </div>
      )}
    </div>
  );
}

// ═══ ICONS (inline SVG, inherit currentColor) ═══
type IconProps = { size?: number; color?: string };
const svg = (size: number, color: string | undefined, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color||'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{display:'block',flexShrink:0}}>{children}</svg>
);
const Icon = {
  History: ({size=16,color}:IconProps) => svg(size,color,<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>),
  Lock: ({size=16,color}:IconProps) => svg(size,color,<><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>),
  Settings: ({size=16,color}:IconProps) => svg(size,color,<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>),
  Globe: ({size=16,color}:IconProps) => svg(size,color,<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>),
  Shield: ({size=16,color}:IconProps) => svg(size,color,<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></>),
  Key: ({size=16,color}:IconProps) => svg(size,color,<><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M15 8l3 3M18 5l2 2"/></>),
  Info: ({size=16,color}:IconProps) => svg(size,color,<><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>),
  Link: ({size=16,color}:IconProps) => svg(size,color,<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>),
  Copy: ({size=12,color}:IconProps) => svg(size,color,<><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>),
  Chevron: ({size=12,color}:IconProps) => svg(size,color,<path d="M6 9l6 6 6-6"/>),
  ChevronRight: ({size=14,color}:IconProps) => svg(size,color,<path d="M9 6l6 6-6 6"/>),
  Back: ({size=18,color}:IconProps) => svg(size,color,<path d="M15 18l-6-6 6-6"/>),
  Check: ({size=16,color}:IconProps) => svg(size,color,<path d="M5 12l5 5L20 7"/>),
  X: ({size=16,color}:IconProps) => svg(size,color,<path d="M6 6l12 12M18 6L6 18"/>),
  ArrowUpRight: ({size=18,color}:IconProps) => svg(size,color,<path d="M7 17L17 7M8 7h9v9"/>),
  ArrowDownLeft: ({size=18,color}:IconProps) => svg(size,color,<path d="M17 7L7 17M16 17H7V8"/>),
};

// ═══ COMPONENTS ═══
function MountainIcon({size=24}:{size?:number}){return(<svg width={size} height={size*0.7} viewBox="0 0 100 70" fill="none" aria-hidden="true"><path d="M50 5L85 65H15L50 5Z" fill={B.lightBlue} opacity="0.3"/><path d="M35 25L60 65H10L35 25Z" fill={B.lightBlue} opacity="0.5"/><path d="M65 20L95 65H35L65 20Z" fill={B.lightBlue} opacity="0.8"/></svg>);}
function Center({children,style:s}:{children:React.ReactNode;style?:any}){return <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flex:1,padding:24,...s}}>{children}</div>;}
function PgWrap({title,onBack,children}:{title:string;onBack?:()=>void;children:React.ReactNode}){return(<div style={{display:'flex',flexDirection:'column',height:'100%',padding:'14px 16px 14px'}}><div style={{display:'flex',alignItems:'center',gap:6,marginBottom:14,marginLeft:onBack?-6:0}}>{onBack&&<IBtn label="Back" onClick={onBack}><Icon.Back /></IBtn>}<h2 style={{fontSize:16,fontWeight:700}}>{title}</h2></div>{children}</div>);}
function Input({label,value,set,type='text',ph,onKey,autoFocus}:{label?:string;value:string;set:(v:string)=>void;type?:string;ph?:string;onKey?:any;autoFocus?:boolean}){
  const id = React.useId();
  return(<div style={{marginBottom:12}}>{label&&<label style={S.label} htmlFor={id}>{label}</label>}<input id={id} type={type} value={value} onChange={e=>set(e.target.value)} placeholder={ph} onKeyDown={onKey} autoFocus={autoFocus} autoComplete={type==='password'?'current-password':'off'} spellCheck={false} style={S.input}/></div>);
}
function Btn({children,onClick,full,secondary,disabled,style:s}:{children:React.ReactNode;onClick?:()=>void;full?:boolean;secondary?:boolean;disabled?:boolean;style?:any}){return(<button onClick={onClick} disabled={disabled} className="gw-btn" style={{width:full?'100%':'auto',padding:'12px 20px',borderRadius:10,background:secondary?'transparent':B.blue,border:secondary?'1px solid #ffffff20':'1px solid transparent',color:'#fff',fontSize:13,fontWeight:600,opacity:disabled?0.5:1,cursor:disabled?'not-allowed':'pointer',transition:'filter .15s, background .15s',fontFamily:'inherit',...s}}>{children}</button>);}
function Card({children,style:s}:{children:React.ReactNode;style?:any}){return <div style={{background:B.bg,borderRadius:12,border:'1px solid #ffffff08',overflow:'hidden',...s}}>{children}</div>;}
function DRow({l,v,vc,mono}:{l:string;v:string;vc?:string;mono?:boolean}){return(<div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,padding:'9px 14px',borderBottom:'1px solid #ffffff06'}}><span style={{fontSize:12,color:'#ffffff60',flexShrink:0}}>{l}</span><span title={v} style={{fontSize:mono?11:12,fontWeight:500,color:vc||'#fff',textAlign:'right',wordBreak:'break-all',fontFamily:mono?'ui-monospace, Menlo, monospace':'inherit'}}>{v}</span></div>);}
function TIcon({s}:{s:string}){const c:Record<string,string>={ETH:'#627eea',SOL:'#14f195',BTC:'#f7931a',BNB:'#f3ba2f',USDT:'#26a17b',USDC:'#2775ca',POL:'#8247e5',AVAX:'#e84142',LINK:'#2a5ada',UNI:'#ff007a',DAI:'#f5ac37',WETH:'#627eea',ARB:'#28a0f0',OP:'#ff0420'};return(<div style={{width:34,height:34,borderRadius:'50%',background:(c[s]||B.blue)+'25',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:c[s]||B.lightBlue,border:`1px solid ${(c[s]||B.blue)}30`,flexShrink:0}}>{(s||'?')[0]}</div>);}
function IBtn({onClick,children,label}:{onClick:()=>void;children:React.ReactNode;label:string}){return <button onClick={onClick} aria-label={label} title={label} className="gw-ibtn" style={{background:'none',border:'none',color:'#ffffff90',padding:6,borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>{children}</button>;}
function Err({children,detail}:{children:React.ReactNode;detail?:string}){
  const [showDetail,setShowDetail]=React.useState(false);
  return <div role="alert" style={{padding:'10px 12px',borderRadius:10,background:'#7f1d1d20',border:'1px solid #f8717130',marginBottom:10}}>
    <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
      <span style={{color:'#fca5a5',flexShrink:0,marginTop:1}}><Icon.Info size={14} /></span>
      <div style={{flex:1}}>
        <p style={{fontSize:12,color:'#fca5a5',lineHeight:1.5,margin:0}}>{children}</p>
        {detail && detail !== String(children) && <button onClick={()=>setShowDetail(!showDetail)} style={{background:'none',border:'none',color:'#ffffff40',fontSize:10,padding:'4px 0 0',cursor:'pointer',fontFamily:'inherit'}}>{showDetail?'Hide':'Show'} details</button>}
        {showDetail && detail && <pre style={{fontSize:9,color:'#ffffff50',marginTop:4,whiteSpace:'pre-wrap',wordBreak:'break-all',lineHeight:1.4,fontFamily:'ui-monospace, Menlo, monospace'}}>{detail}</pre>}
      </div>
    </div>
  </div>;
}
function Muted({children,mt=0,style:s}:{children:React.ReactNode;mt?:number;style?:any}){return <div style={{fontSize:12,color:'#ffffff60',marginTop:mt,...s}}>{children}</div>;}
function Loader(){return <div role="progressbar" aria-label="Loading" style={{width:24,height:24,border:`2px solid ${B.blue}40`,borderTopColor:B.blue,borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto'}}/>;}
function Warn({title,text,tone='danger'}:{title:string;text:string;tone?:'danger'|'info'}){
  const danger = tone==='danger';
  return(<div style={{background:danger?'#7f1d1d15':`${B.blue}18`,border:`1px solid ${danger?'#f8717130':B.blue+'50'}`,borderRadius:10,padding:12,marginTop:8,marginBottom:8}}><p style={{fontSize:11,color:danger?B.yellow:B.lightBlue,fontWeight:600,marginBottom:2}}>{title}</p><p style={{fontSize:11,color:'#ffffff80',lineHeight:1.5}}>{text}</p></div>);
}
function SItem({icon,l,d,onClick,href}:{icon:React.ReactNode;l:string;d:string;onClick?:()=>void;href?:string}){
  const style: React.CSSProperties = {display:'flex',alignItems:'center',gap:12,padding:'12px 8px',margin:'0 -4px',width:'calc(100% + 8px)',background:'none',border:'none',borderBottom:'1px solid #ffffff08',color:'#fff',fontFamily:'inherit',cursor:(onClick||href)?'pointer':'default',textAlign:'left',textDecoration:'none',borderRadius:10};
  const inner = (<><span style={{width:28,display:'flex',color:B.lightBlue}}>{icon}</span><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600}}>{l}</div><Muted mt={0} style={{fontSize:11}}>{d}</Muted></div>{(onClick||href)&&<span style={{color:'#ffffff30',display:'flex'}}>{href?<span style={{fontSize:12}}>↗</span>:<Icon.ChevronRight />}</span>}</>);
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="gw-row" style={style}>{inner}</a>;
  return <button onClick={onClick} className={onClick?'gw-row':undefined} style={style}>{inner}</button>;
}
function SeedGrid({phrase}:{phrase:string}){
  const words = phrase.split(' ').filter(Boolean);
  return (<div style={{...S.seedGrid,gridTemplateColumns:words.length>12?'1fr 1fr 1fr':'1fr 1fr'}} data-testid="seed-grid">
    {words.map((w,i)=>(<div key={i} style={S.seedWord}><span style={{fontSize:10,color:'#ffffff40',width:16,flexShrink:0}}>{i+1}.</span><span data-testid="seed-word" style={{fontSize:words.length>12?12:13,fontWeight:500}}>{w}</span></div>))}
  </div>);
}
function QRCode({data,size=180}:{data:string;size?:number}){
  const [src,setSrc]=React.useState('');
  React.useEffect(()=>{let live=true;if(!data){setSrc('');return;}QRCodeLib.toDataURL(data,{width:size*2,margin:1,errorCorrectionLevel:'M',color:{dark:'#023859',light:'#ffffff'}}).then(u=>{if(live)setSrc(u);}).catch(()=>{if(live)setSrc('');});return()=>{live=false;};},[data,size]);
  return src?<img src={src} width={size} height={size} alt="Address QR code" style={{display:'block'}}/>:<div style={{width:size,height:size}}/>;
}

function fmtVal(v:string):string{if(!v||v==='0'||v==='0x0')return '0';try{const n=v.startsWith('0x')?Number(BigInt(v))/1e18:parseFloat(v);if(n===0)return '0';return n<0.0001?'<0.0001':trimZeros(n.toFixed(6));}catch{return v;}}
function fmtAmount(v?:string|number):string{const n=typeof v==='number'?v:parseFloat(v||'0');if(!isFinite(n)||n===0)return '0';if(n<0.0001)return '<0.0001';if(n>=1000)return n.toLocaleString('en-US',{maximumFractionDigits:2});return trimZeros(n.toFixed(n>=1?4:6));}
function trimZeros(s:string):string{return s.includes('.')?s.replace(/\.?0+$/,''):s;}
function cap(s?:string):string{return s?s[0].toUpperCase()+s.slice(1):'';}
function decMsg(m:string):string{if(m.startsWith('0x')){try{const h=m.slice(2);const bytes=new Uint8Array(h.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(h.substr(i*2,2),16);return new TextDecoder().decode(bytes);}catch{return m;}}return m;}

const S:Record<string,React.CSSProperties> = {
  root:{width:360,height:600,background:B.navy,overflow:'hidden',display:'flex',flexDirection:'column',color:'#fff',fontFamily:"'Poppins',system-ui,sans-serif"},
  label:{fontSize:11,color:'#ffffff70',display:'block',marginBottom:4,fontWeight:500},
  input:{width:'100%',padding:'10px 12px',borderRadius:10,background:B.bg,border:'1px solid #ffffff15',color:'#fff',fontSize:13,fontFamily:'inherit'},
  textarea:{width:'100%',padding:12,borderRadius:10,background:B.bg,border:'1px solid #ffffff15',color:'#fff',fontSize:13,resize:'none' as const,fontFamily:'inherit',lineHeight:1.5},
  chip:{padding:'6px 12px',borderRadius:8,background:'#ffffff08',border:'1px solid #ffffff15',color:'#fff',fontSize:12,cursor:'pointer',fontFamily:'inherit'},
  chainPill:{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:100,background:'#ffffff08',border:'1px solid #ffffff15',color:'#fff',cursor:'pointer',fontFamily:'inherit'},
  addrPill:{display:'flex',alignItems:'center',gap:6,padding:'5px 12px',borderRadius:100,background:`${B.blue}15`,border:`1px solid ${B.blue}25`,color:B.lightBlue,fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:'inherit'},
  actionBtn:{display:'flex',flexDirection:'column' as const,alignItems:'center',gap:4,background:`${B.blue}15`,border:`1px solid ${B.blue}15`,borderRadius:12,padding:'10px 14px',color:'#fff',minWidth:72,cursor:'pointer',fontFamily:'inherit'},
  seedGrid:{background:B.bg,border:'1px solid #ffffff10',borderRadius:12,padding:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:12},
  seedWord:{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',borderRadius:6,background:'#ffffff06'},
  checkRow:{display:'flex',alignItems:'flex-start',gap:10,padding:'4px 2px',cursor:'pointer'},
  linkBtn:{background:'none',border:'none',color:B.lightBlue,fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0},
  toast:{position:'fixed' as const,top:12,left:'50%',transform:'translateX(-50%)',background:B.green,color:B.black,padding:'8px 20px',borderRadius:100,fontSize:12,fontWeight:600,zIndex:999,boxShadow:'0 4px 20px #00000060',whiteSpace:'nowrap' as const},
};

const CSS = `*{margin:0;padding:0;box-sizing:border-box}input,select,textarea,button{font-family:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed}input:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid ${B.blue};outline-offset:1px}input:focus,textarea:focus{outline:2px solid ${B.blue};outline-offset:0}::selection{background:${B.blue}}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${B.blue}30;border-radius:4px}@keyframes spin{to{transform:rotate(360deg)}}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}input::placeholder,textarea::placeholder{color:#ffffff40}.gw-btn:not(:disabled):hover{filter:brightness(1.12)}.gw-ibtn:hover{background:#ffffff10;color:#fff}.gw-row:hover{background:#ffffff08}.gw-action:hover{background:${B.blue}30 !important}`;

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
