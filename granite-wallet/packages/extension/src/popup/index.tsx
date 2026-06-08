// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Complete Popup UI
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

import '../polyfills';
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
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
  bitcoin:{name:'Bitcoin',icon:'₿',symbol:'BTC',color:'#f7931a'},
};

type Page = 'loading'|'welcome'|'create'|'import'|'backup'|'unlock'|'home'|'send'|'send_confirm'|'receive'|'swap'|'swap_confirm'|'history'|'settings'|'connected_apps'|'chain_selector'|'approve_connect'|'approve_tx'|'approve_sign';

function App() {
  const [page, setPage] = useState<Page>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [walletName, setWalletName] = useState('Main Wallet');
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const setErr = (e: any, fallback?: string) => {
    const msg = e?.message || fallback || 'An unexpected error occurred.';
    const detail = e?.detail || '';
    setError(msg);
    setErrorDetail(detail);
  };
  const clearErr = () => { setError(''); setErrorDetail(''); };
  const [wallets, setWallets] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [activeChain, setActiveChain] = useState('ethereum');
  const [activeAddress, setActiveAddress] = useState('');
  const [txHistory] = useState<any[]>([]);
  const [connectedApps, setConnectedApps] = useState<any[]>([]);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendToken, setSendToken] = useState<any>(null);
  const [sendGasEstimate, setSendGasEstimate] = useState<any>(null);
  const [sendGasSpeed, setSendGasSpeed] = useState<'slow'|'normal'|'fast'>('normal');
  const [swapFrom, setSwapFrom] = useState<any>(null);
  const [swapTo, setSwapTo] = useState<any>(null);
  const [swapAmount, setSwapAmount] = useState('');
  const [swapQuote, setSwapQuote] = useState<any>(null);
  const [swapSlippage, setSwapSlippage] = useState(50);
  const [swapLoading, setSwapLoading] = useState(false);
  const [currentApproval, setCurrentApproval] = useState<any>(null);

  const [initError, setInitError] = useState('');

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
          setInitError('Could not connect to wallet service. Please close and reopen the extension.');
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

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadWalletData = useCallback(async () => {
    try {
      const w = await api.getWallets(); setWallets(w);
      const chain = await api.getActiveChain(); setActiveChain(chain);
      const addr = await api.getAddress(chain); setActiveAddress(addr || '');
      api.getBalances(chain).then(b => {
        setBalances(b);
        if (b.length > 0 && !sendToken) setSendToken(b[0]?.token);
        if (b.length > 0 && !swapFrom) setSwapFrom(b[0]?.token);
        if (b.length > 1 && !swapTo) setSwapTo(b[1]?.token);
      }).catch(console.warn);
      api.getConnectedDApps().then(setConnectedApps).catch(() => {});
    } catch (err) { console.warn('Load failed:', err); }
  }, []);

  const handleCreate = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true); clearErr();
    try { const r = await api.createWallet(password, walletName); setMnemonic(r.mnemonic); setPage('backup'); }
    catch (e: any) { setErr(e, 'Failed to create wallet.'); } finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!importPhrase.trim()) { setError('Please enter your seed phrase.'); return; }
    setLoading(true); clearErr();
    try { await api.importWallet(password, walletName, importPhrase.trim()); await loadWalletData(); setPage('home'); }
    catch (e: any) { setErr(e, 'Failed to import wallet.'); } finally { setLoading(false); }
  };

  const handleUnlock = async () => {
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true); clearErr();
    try {
      await api.unlock(password); await loadWalletData();
      const approvals = await api.getPendingApprovals();
      if (approvals.length > 0) showApproval(approvals[0]); else setPage('home');
    } catch (e: any) { setErr(e, 'Incorrect password. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleLock = async () => { await api.lock(); setPassword(''); setPage('unlock'); };
  const handleBackupDone = async () => { setMnemonic(''); await loadWalletData(); setPage('home'); };

  const handleSwitchChain = async (chain: string) => {
    await api.setActiveChain(chain); setActiveChain(chain);
    const addr = await api.getAddress(chain); setActiveAddress(addr || '');
    setBalances([]); setPage('home');
    api.getBalances(chain).then(setBalances).catch(console.warn);
  };

  const handleSendPreview = async () => {
    if (!sendTo || !sendAmount) { setError('Please enter a recipient address and amount.'); return; }
    setLoading(true); clearErr();
    try {
      const v = await api.validateAddress(activeChain, sendTo);
      if (!v.valid) { setError(v.error || 'Invalid address.'); setLoading(false); return; }
      const gas = await api.estimateGas({ chain: activeChain, from: activeAddress, to: sendTo, value: sendAmount, token: sendToken?.address ? sendToken : undefined });
      setSendGasEstimate(gas); setPage('send_confirm');
    } catch (e: any) { setErr(e, 'Failed to estimate gas fees.'); }
    finally { setLoading(false); }
  };

  const handleSendConfirm = async () => {
    setLoading(true); clearErr();
    try {
      const gs = sendGasEstimate?.[sendGasSpeed] || {};
      const txHash = await api.sendTransaction({ chain: activeChain, from: activeAddress, to: sendTo, value: sendAmount, token: sendToken?.address ? sendToken : undefined, maxFeePerGas: gs.maxFeePerGas, maxPriorityFeePerGas: gs.maxPriorityFeePerGas });
      showToast(`Sent! TX: ${txHash.slice(0, 10)}...`);
      setSendTo(''); setSendAmount(''); setSendGasEstimate(null); setPage('home'); loadWalletData();
    } catch (e: any) { setErr(e, 'Transaction failed.'); }
    finally { setLoading(false); }
  };

  const handleGetSwapQuote = async () => {
    if (!swapFrom || !swapTo || !swapAmount || parseFloat(swapAmount) <= 0) return;
    setSwapLoading(true); setSwapQuote(null); clearErr();
    try {
      const q = await api.getSwapQuote({ chain: activeChain, fromToken: swapFrom, toToken: swapTo, amount: swapAmount, slippageBps: swapSlippage, fromAddress: activeAddress });
      setSwapQuote(q); setPage('swap_confirm');
    } catch (e: any) { setErr(e, 'Could not find a swap route.'); }
    finally { setSwapLoading(false); }
  };

  const handleSwapConfirm = async () => {
    setLoading(true); clearErr();
    try {
      const txHash = await api.executeSwap({ chain: activeChain, fromToken: swapFrom, toToken: swapTo, amount: swapAmount, slippageBps: swapSlippage, fromAddress: activeAddress });
      showToast(`Swap sent! TX: ${txHash.slice(0, 10)}...`);
      setSwapAmount(''); setSwapQuote(null); setPage('home'); loadWalletData();
    } catch (e: any) { setErr(e, 'Swap failed.'); }
    finally { setLoading(false); }
  };

  const handleApprove = async () => {
    if (!currentApproval) return; setLoading(true);
    try { await api.approveRequest(currentApproval.id); showToast('Approved'); setCurrentApproval(null); setPage('home'); }
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
      {toast && <div style={S.toast}>{toast}</div>}

      {page === 'loading' && <Center><Loader /><Muted mt={12}>Connecting to wallet...</Muted>{initError && <div style={{marginTop:12}}><Err>{initError}</Err></div>}</Center>}

      {page === 'welcome' && (
        <Center>
          <MountainIcon size={56} />
          <h1 style={{fontSize:22,fontWeight:700,margin:'16px 0 4px'}}>Granite Wallet</h1>
          <Muted mt={0} style={{letterSpacing:2,fontSize:10,marginBottom:32}}>BLACK MOUNTAIN INVESTMENT GROUP</Muted>
          {initError && <div style={{marginBottom:16,width:'100%'}}><Err>{initError}</Err></div>}
          <Muted mt={0} style={{textAlign:'center',maxWidth:280,marginBottom:32,lineHeight:1.6,fontSize:13}}>Self-custody wallet & decentralized exchange. Your keys, your crypto.</Muted>
          <Btn onClick={()=>{setPage('create');setError('');setInitError('')}} full>Create New Wallet</Btn>
          <div style={{height:10}} />
          <Btn onClick={()=>{setPage('import');setError('');setInitError('')}} full secondary>Import Seed Phrase</Btn>
        </Center>
      )}

      {page === 'create' && (
        <PgWrap title="Create Wallet" onBack={()=>{setPage('welcome');clearErr()}}>
          <Input label="Wallet Name" value={walletName} set={setWalletName} ph="Main Wallet" />
          <Input label="Password" value={password} set={setPassword} type="password" ph="At least 8 characters" />
          <Input label="Confirm Password" value={confirmPassword} set={setConfirmPassword} type="password" ph="Confirm password" />
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <Btn onClick={handleCreate} full disabled={loading}>{loading ? 'Creating...' : 'Create Wallet'}</Btn>
        </PgWrap>
      )}

      {page === 'import' && (
        <PgWrap title="Import Wallet" onBack={()=>{setPage('welcome');clearErr()}}>
          <Input label="Wallet Name" value={walletName} set={setWalletName} ph="Imported Wallet" />
          <div style={{marginBottom:12}}>
            <label style={S.label}>Seed Phrase</label>
            <textarea value={importPhrase} onChange={e=>setImportPhrase(e.target.value)} placeholder="Enter your 12 or 24 word seed phrase..." rows={3} style={S.textarea} />
          </div>
          <Input label="Password" value={password} set={setPassword} type="password" ph="At least 8 characters" />
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <Btn onClick={handleImport} full disabled={loading}>{loading ? 'Importing...' : 'Import Wallet'}</Btn>
        </PgWrap>
      )}

      {page === 'backup' && (
        <PgWrap title="Backup Seed Phrase">
          <Warn title="IMPORTANT" text="Write down these words in order. Never share them. This is the ONLY way to recover your wallet." />
          <div style={S.seedGrid}>
            {mnemonic.split(' ').map((w,i)=>(
              <div key={i} style={S.seedWord}><span style={{fontSize:10,color:'#ffffff40',width:16}}>{i+1}.</span><span style={{fontSize:13,fontWeight:500}}>{w}</span></div>
            ))}
          </div>
          <div style={{flex:1}} />
          <Btn onClick={handleBackupDone} full>I've Saved My Seed Phrase</Btn>
        </PgWrap>
      )}

      {page === 'unlock' && (
        <Center>
          <MountainIcon size={48} />
          <h2 style={{fontSize:18,fontWeight:700,margin:'16px 0 4px'}}>Welcome Back</h2>
          <Muted mt={0} style={{marginBottom:24}}>Enter your password to unlock</Muted>
          <div style={{width:'100%',maxWidth:280}}>
            <Input value={password} set={setPassword} type="password" ph="Password" onKey={(e:any)=>e.key==='Enter'&&handleUnlock()} />
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
            <div style={{display:'flex',alignItems:'center',gap:8}}><MountainIcon size={18} /><span style={{fontSize:13,fontWeight:600}}>Granite</span></div>
            <div style={{display:'flex',gap:6}}>
              <IBtn onClick={()=>setPage('history')}>📜</IBtn>
              <IBtn onClick={handleLock}>🔒</IBtn>
              <IBtn onClick={()=>setPage('settings')}>⚙</IBtn>
            </div>
          </div>
          <div style={{padding:'10px 16px 0'}}>
            <button onClick={()=>setPage('chain_selector')} style={{...S.chainPill,borderColor:chainInfo.color+'40'}}>
              <span style={{fontSize:14}}>{chainInfo.icon}</span><span style={{fontSize:12,fontWeight:500}}>{chainInfo.name}</span><span style={{fontSize:10,color:'#ffffff40'}}>▾</span>
            </button>
          </div>
          <div style={{padding:'8px 16px'}}>
            <button onClick={()=>{navigator.clipboard.writeText(activeAddress);showToast('Address copied!')}} style={S.addrPill}>
              <span style={{width:6,height:6,borderRadius:'50%',background:B.green}} />{shortAddr||'No address'}<span style={{color:'#ffffff40',fontSize:10}}>⎘</span>
            </button>
          </div>
          <div style={{textAlign:'center',padding:'4px 16px 16px'}}>
            <div style={{fontSize:34,fontWeight:700,letterSpacing:-1}}>${totalBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <Muted mt={2}>Portfolio Balance</Muted>
          </div>
          <div style={{display:'flex',justifyContent:'center',gap:12,padding:'0 16px 14px'}}>
            {[{l:'Send',i:'↗',a:()=>setPage('send')},{l:'Receive',i:'↙',a:()=>setPage('receive')},{l:'Swap',i:'⇄',a:()=>setPage('swap')},{l:'Buy',i:'+',a:()=>showToast('Coming soon!')}].map(x=>(
              <button key={x.l} onClick={x.a} style={S.actionBtn}><span style={{fontSize:18,lineHeight:'1'}}>{x.i}</span><span style={{fontSize:10,color:B.lightBlue}}>{x.l}</span></button>
            ))}
          </div>
          <div style={{flex:1,overflow:'auto',padding:'0 10px 10px'}}>
            <Card>
              <div style={{padding:'10px 14px',borderBottom:'1px solid #ffffff08',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between'}}><span>Tokens</span><Muted mt={0}>{balances.length} assets</Muted></div>
              {balances.length === 0 ? <div style={{padding:28,textAlign:'center'}}><Loader /><Muted mt={8}>Loading balances...</Muted></div>
              : balances.map((b,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',borderBottom:i<balances.length-1?'1px solid #ffffff05':'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <TIcon s={b.token.symbol} />
                    <div><div style={{fontSize:13,fontWeight:600}}>{b.token.symbol||'?'}</div><Muted mt={0} style={{fontSize:10}}>{b.token.name}</Muted></div>
                  </div>
                  <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:600}}>{parseFloat(b.balanceFormatted||'0').toFixed(4)}</div><Muted mt={0} style={{fontSize:10}}>${(b.usdValue||0).toFixed(2)}</Muted></div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}

      {/* ═══ CHAIN SELECTOR ═══ */}
      {page === 'chain_selector' && (
        <PgWrap title="Select Network" onBack={()=>setPage('home')}>
          {Object.entries(CHAIN_META).map(([k,m])=>(
            <button key={k} onClick={()=>handleSwitchChain(k)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 4px',width:'100%',background:activeChain===k?B.blue+'20':'transparent',border:'none',borderBottom:'1px solid #ffffff08',color:'#fff',fontFamily:'inherit',cursor:'pointer',borderRadius:activeChain===k?8:0}}>
              <span style={{fontSize:20,width:32,textAlign:'center'}}>{m.icon}</span>
              <div style={{flex:1,textAlign:'left'}}><div style={{fontSize:13,fontWeight:600}}>{m.name}</div><Muted mt={0} style={{fontSize:11}}>{m.symbol}</Muted></div>
              {activeChain===k && <span style={{color:B.green,fontSize:16}}>✓</span>}
            </button>
          ))}
        </PgWrap>
      )}

      {/* ═══ SEND ═══ */}
      {page === 'send' && (
        <PgWrap title="Send" onBack={()=>{setPage('home');clearErr()}}>
          <label style={S.label}>Token</label>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
            {balances.map((b,i)=>(<button key={i} onClick={()=>setSendToken(b.token)} style={{...S.chip,background:sendToken?.symbol===b.token.symbol?B.blue+'30':'#ffffff08',borderColor:sendToken?.symbol===b.token.symbol?B.blue:'#ffffff15'}}>{b.token.symbol}</button>))}
          </div>
          <Input label="Recipient Address" value={sendTo} set={setSendTo} ph="0x... or SOL address" />
          <Input label={`Amount (${sendToken?.symbol||''})`} value={sendAmount} set={setSendAmount} ph="0.0" type="number" />
          {sendToken && (()=>{const bal=balances.find((b:any)=>b.token.symbol===sendToken.symbol);const mx=parseFloat(bal?.balanceFormatted||'0');return(
            <div style={{display:'flex',gap:6,marginBottom:12}}>{[25,50,75,100].map(p=><button key={p} onClick={()=>setSendAmount((mx*p/100).toFixed(6))} style={{...S.chip,flex:1,textAlign:'center'}}>{p}%</button>)}</div>
          );})()}
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <Btn onClick={handleSendPreview} full disabled={loading||!sendTo||!sendAmount}>{loading?'Estimating...':'Preview Transaction'}</Btn>
        </PgWrap>
      )}

      {/* ═══ SEND CONFIRM ═══ */}
      {page === 'send_confirm' && (
        <PgWrap title="Confirm Send" onBack={()=>{setPage('send');clearErr()}}>
          <Card><div style={{padding:16,textAlign:'center'}}><div style={{fontSize:28,fontWeight:700,marginBottom:4}}>{sendAmount} {sendToken?.symbol}</div><Muted mt={0}>Sending on {chainInfo.name}</Muted></div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="To" v={`${sendTo.slice(0,10)}...${sendTo.slice(-6)}`} />
            <DRow l="From" v={shortAddr} />
            <DRow l="Network" v={chainInfo.name} />
            {sendGasEstimate && <>
              <div style={{padding:'8px 14px',borderTop:'1px solid #ffffff08'}}>
                <label style={{...S.label,marginBottom:6}}>Gas Speed</label>
                <div style={{display:'flex',gap:6}}>
                  {(['slow','normal','fast'] as const).map(sp=>(<button key={sp} onClick={()=>setSendGasSpeed(sp)} style={{...S.chip,flex:1,textAlign:'center',background:sendGasSpeed===sp?B.blue+'30':'#ffffff08',borderColor:sendGasSpeed===sp?B.blue:'#ffffff15'}}><div style={{fontSize:11,fontWeight:600,textTransform:'capitalize'}}>{sp}</div><div style={{fontSize:9,color:'#ffffff50'}}>{sendGasEstimate[sp]?.estimatedSeconds}s</div></button>))}
                </div>
              </div>
              <DRow l="Est. Fee" v={`~$${(sendGasEstimate.estimatedCostUsd||0).toFixed(4)}`} />
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
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:16}}><span style={{fontSize:16}}>{chainInfo.icon}</span><span style={{fontSize:14,fontWeight:600}}>{chainInfo.name}</span></div>
            <div style={{background:'#fff',borderRadius:12,padding:16,display:'inline-block',marginBottom:16}}><QRCode data={activeAddress} size={180} /></div>
            <div style={{fontSize:11,wordBreak:'break-all',color:'#ffffff90',lineHeight:1.6,padding:'0 8px'}}>{activeAddress}</div>
          </div></Card>
          <div style={{height:12}} />
          <Btn onClick={()=>{navigator.clipboard.writeText(activeAddress);showToast('Address copied!')}} full>Copy Address</Btn>
          <Warn title="Note" text={`Only send ${chainInfo.symbol} and tokens on ${chainInfo.name} to this address. Sending other assets may result in permanent loss.`} />
        </PgWrap>
      )}

      {/* ═══ SWAP ═══ */}
      {page === 'swap' && (
        <PgWrap title="Granite Exchange" onBack={()=>{setPage('home');clearErr()}}>
          <label style={S.label}>You Pay</label>
          <Card style={{marginBottom:12}}><div style={{padding:14,display:'flex',alignItems:'center',gap:10}}>
            <select value={swapFrom?.symbol||''} onChange={e=>{const t=balances.find((b:any)=>b.token.symbol===e.target.value)?.token;if(t)setSwapFrom(t);}} style={S.select}>
              {balances.map((b:any,i:number)=><option key={i} value={b.token.symbol}>{b.token.symbol}</option>)}
            </select>
            <input type="number" value={swapAmount} onChange={e=>setSwapAmount(e.target.value)} placeholder="0.0" style={{flex:1,textAlign:'right',fontSize:20,fontWeight:700,border:'none',background:'transparent',color:'#fff',padding:0,fontFamily:'inherit',outline:'none'}} />
          </div>
          {swapFrom && (()=>{const bal=balances.find((b:any)=>b.token.symbol===swapFrom.symbol);return <div style={{padding:'0 14px 10px',display:'flex',justifyContent:'space-between'}}><Muted mt={0} style={{fontSize:11}}>Balance: {parseFloat(bal?.balanceFormatted||'0').toFixed(4)}</Muted><button onClick={()=>setSwapAmount(bal?.balanceFormatted||'0')} style={{fontSize:11,color:B.blue,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>MAX</button></div>;})()}
          </Card>
          <div style={{textAlign:'center',margin:'-6px 0'}}><button onClick={()=>{const t=swapFrom;setSwapFrom(swapTo);setSwapTo(t);}} style={{background:B.blue,border:'none',borderRadius:'50%',width:32,height:32,color:'#fff',fontSize:16,cursor:'pointer',position:'relative',zIndex:1}}>↕</button></div>
          <label style={{...S.label,marginTop:6}}>You Receive</label>
          <Card style={{marginBottom:12}}><div style={{padding:14,display:'flex',alignItems:'center',gap:10}}>
            <select value={swapTo?.symbol||''} onChange={e=>{const t=balances.find((b:any)=>b.token.symbol===e.target.value)?.token;if(t)setSwapTo(t);}} style={S.select}>
              {balances.map((b:any,i:number)=><option key={i} value={b.token.symbol}>{b.token.symbol}</option>)}
            </select>
            <div style={{flex:1,textAlign:'right',fontSize:20,fontWeight:700,color:'#ffffff50'}}>{swapQuote?parseFloat(swapQuote.toAmount).toFixed(6):'—'}</div>
          </div></Card>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <Muted mt={0} style={{fontSize:11}}>Slippage Tolerance</Muted>
            <div style={{display:'flex',gap:4}}>{[25,50,100,200].map(bp=><button key={bp} onClick={()=>setSwapSlippage(bp)} style={{...S.chip,fontSize:10,padding:'4px 8px',background:swapSlippage===bp?B.blue+'30':'#ffffff08',borderColor:swapSlippage===bp?B.blue:'#ffffff15'}}>{(bp/100).toFixed(1)}%</button>)}</div>
          </div>
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <Btn onClick={handleGetSwapQuote} full disabled={swapLoading||!swapAmount||!swapFrom||!swapTo}>{swapLoading?'Finding best route...':'Get Quote'}</Btn>
        </PgWrap>
      )}

      {/* ═══ SWAP CONFIRM ═══ */}
      {page === 'swap_confirm' && swapQuote && (
        <PgWrap title="Confirm Swap" onBack={()=>{setPage('swap');clearErr()}}>
          <Card><div style={{padding:16,textAlign:'center'}}>
            <div style={{fontSize:14,color:'#ffffff60',marginBottom:4}}>You Pay</div>
            <div style={{fontSize:24,fontWeight:700}}>{swapAmount} {swapFrom?.symbol}</div>
            <div style={{fontSize:24,margin:'8px 0',color:'#ffffff40'}}>↓</div>
            <div style={{fontSize:14,color:'#ffffff60',marginBottom:4}}>You Receive</div>
            <div style={{fontSize:24,fontWeight:700,color:B.green}}>{parseFloat(swapQuote.toAmount).toFixed(6)} {swapTo?.symbol}</div>
          </div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="Rate" v={`1 ${swapFrom?.symbol} = ${parseFloat(swapQuote.exchangeRate).toFixed(6)} ${swapTo?.symbol}`} />
            <DRow l="Price Impact" v={`${swapQuote.priceImpact}%`} vc={swapQuote.priceImpact>3?B.red:swapQuote.priceImpact>1?B.yellow:B.green} />
            <DRow l="Route" v={swapQuote.route.map((r:any)=>r.protocol).join(' → ')} />
            <DRow l="Slippage" v={`${(swapSlippage/100).toFixed(1)}%`} />
            <DRow l="Network Fee" v={`~$${(swapQuote.estimatedFeeUsd||0).toFixed(4)}`} />
            <DRow l="Min. Received" v={`${(parseFloat(swapQuote.toAmount)*(1-swapSlippage/10000)).toFixed(6)} ${swapTo?.symbol}`} />
          </Card>
          {swapQuote.priceImpact > 3 && <Warn title="High Price Impact" text={`This swap has a ${swapQuote.priceImpact}% price impact. Consider reducing the amount.`} />}
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={()=>{setPage('swap');clearErr()}} secondary style={{flex:1}}>Cancel</Btn>
            <Btn onClick={handleSwapConfirm} disabled={loading} style={{flex:2}}>{loading?'Swapping...':'Confirm Swap'}</Btn>
          </div>
        </PgWrap>
      )}

      {/* ═══ HISTORY ═══ */}
      {page === 'history' && (
        <PgWrap title="Activity" onBack={()=>setPage('home')}>
          {txHistory.length === 0 ? (
            <Center style={{flex:1,opacity:0.5}}><span style={{fontSize:36,marginBottom:8}}>📜</span><Muted mt={0}>No transactions yet</Muted><Muted mt={0} style={{fontSize:11}}>Your activity will appear here</Muted></Center>
          ) : txHistory.map((tx,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 4px',borderBottom:'1px solid #ffffff08'}}>
              <span style={{fontSize:18}}>{tx.direction==='sent'?'↗':'↙'}</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{tx.direction==='sent'?'Sent':'Received'} {tx.token?.symbol||chainInfo.symbol}</div><Muted mt={0} style={{fontSize:10}}>{new Date(tx.timestamp).toLocaleString()}</Muted></div>
              <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:600,color:tx.direction==='sent'?B.red:B.green}}>{tx.direction==='sent'?'-':'+'}{tx.value}</div><Muted mt={0} style={{fontSize:10}}>{tx.status}</Muted></div>
            </div>
          ))}
        </PgWrap>
      )}

      {/* ═══ SETTINGS ═══ */}
      {page === 'settings' && (
        <PgWrap title="Settings" onBack={()=>setPage('home')}>
          <SItem i="🌐" l="Connected Apps" d={`${connectedApps.length} connected`} onClick={()=>setPage('connected_apps')} />
          <SItem i="⛓" l="Networks" d="Manage chains & RPCs" onClick={()=>setPage('chain_selector')} />
          <SItem i="🔐" l="Security" d="Password, auto-lock" />
          <SItem i="💾" l="Backup" d="Export seed phrase" />
          <SItem i="ℹ" l="About" d="Granite Wallet v0.1.0 · BMIG" />
          <div style={{flex:1}} />
          <Btn onClick={handleLock} full secondary>Lock Wallet</Btn>
        </PgWrap>
      )}

      {page === 'connected_apps' && (
        <PgWrap title="Connected Apps" onBack={()=>setPage('settings')}>
          {connectedApps.length === 0 ? (
            <Center style={{flex:1,opacity:0.5}}><span style={{fontSize:36,marginBottom:8}}>🌐</span><Muted mt={0}>No connected apps</Muted></Center>
          ) : connectedApps.map((app,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 4px',borderBottom:'1px solid #ffffff08'}}>
              <span style={{fontSize:18}}>🌐</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{app.name||app.origin}</div><Muted mt={0} style={{fontSize:10}}>{app.origin}</Muted></div>
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
            <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{currentApproval.data.siteName||'Unknown dApp'}</div>
            <Muted mt={0} style={{wordBreak:'break-all'}}>{currentApproval.data.origin}</Muted>
          </div></Card>
          <div style={{height:12}} />
          <Card><div style={{padding:14}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>This site will be able to:</div>
            {['View your wallet address','Request transaction approval','Suggest token transfers'].map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}><span style={{color:B.green,fontSize:12}}>✓</span><Muted mt={0} style={{fontSize:12}}>{p}</Muted></div>
            ))}
            <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}><span style={{color:B.red,fontSize:12}}>✗</span><Muted mt={0} style={{fontSize:12}}>Cannot access private keys or move funds without approval</Muted></div>
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
            <div style={{fontSize:26,fontWeight:700,marginBottom:4}}>{fmtVal(currentApproval.data.value)} {chainInfo.symbol}</div>
            <Muted mt={0}>on {currentApproval.data.chainName||chainInfo.name}</Muted>
          </div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="From" v={`${(currentApproval.data.from||'').slice(0,10)}...`} />
            <DRow l="To" v={`${(currentApproval.data.to||'').slice(0,10)}...${(currentApproval.data.to||'').slice(-6)}`} />
            <DRow l="Network" v={currentApproval.data.chainName||chainInfo.name} />
            {currentApproval.data.data && currentApproval.data.data!=='0x' && <DRow l="Contract Call" v="Yes — review carefully" vc={B.yellow} />}
            <DRow l="Origin" v={currentApproval.data.origin} />
          </Card>
          {currentApproval.data.data && currentApproval.data.data!=='0x' && <Warn title="Contract Interaction" text="This transaction includes contract data. Make sure you trust this site." />}
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
            <div style={{fontSize:12,fontWeight:600,marginBottom:4}}>{currentApproval.type==='sign_typed_data'?'Typed Data (EIP-712)':'Message'}</div>
            <div style={{background:'#ffffff06',borderRadius:8,padding:10,fontSize:12,color:'#ffffff80',wordBreak:'break-all',maxHeight:160,overflow:'auto',lineHeight:1.5,fontFamily:'monospace'}}>
              {currentApproval.type==='sign_typed_data'?JSON.stringify(currentApproval.data.typedData,null,2):decMsg(currentApproval.data.message||'')}
            </div>
          </div></Card>
          <div style={{height:12}} />
          <Card>
            <DRow l="Account" v={`${(currentApproval.data.address||'').slice(0,10)}...`} />
            <DRow l="Origin" v={currentApproval.data.origin} />
          </Card>
          <Warn title="What does signing mean?" text="Signing proves you own this wallet. It does NOT send a transaction. However, some signatures can authorize token transfers — review carefully." />
          {error && <Err detail={errorDetail}>{error}</Err>}
          <div style={{flex:1}} />
          <div style={{display:'flex',gap:8}}><Btn onClick={handleReject} secondary style={{flex:1}}>Reject</Btn><Btn onClick={handleApprove} disabled={loading} style={{flex:2}}>{loading?'Signing...':'Sign'}</Btn></div>
        </div>
      )}
    </div>
  );
}

// ═══ COMPONENTS ═══
function MountainIcon({size=24}:{size?:number}){return(<svg width={size} height={size*0.7} viewBox="0 0 100 70" fill="none"><path d="M50 5L85 65H15L50 5Z" fill={B.lightBlue} opacity="0.3"/><path d="M35 25L60 65H10L35 25Z" fill={B.lightBlue} opacity="0.5"/><path d="M65 20L95 65H35L65 20Z" fill={B.lightBlue} opacity="0.8"/></svg>);}
function Center({children,style:s}:{children:React.ReactNode;style?:any}){return <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flex:1,padding:24,...s}}>{children}</div>;}
function PgWrap({title,onBack,children}:{title:string;onBack?:()=>void;children:React.ReactNode}){return(<div style={{display:'flex',flexDirection:'column',height:'100%',padding:'16px 16px 14px'}}><div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>{onBack&&<button onClick={onBack} style={{background:'none',border:'none',color:'#fff',fontSize:18,padding:0,cursor:'pointer'}}>←</button>}<h2 style={{fontSize:16,fontWeight:700}}>{title}</h2></div>{children}</div>);}
function Input({label,value,set,type='text',ph,onKey}:{label?:string;value:string;set:(v:string)=>void;type?:string;ph?:string;onKey?:any}){return(<div style={{marginBottom:12}}>{label&&<label style={S.label}>{label}</label>}<input type={type} value={value} onChange={e=>set(e.target.value)} placeholder={ph} onKeyDown={onKey} style={S.input}/></div>);}
function Btn({children,onClick,full,secondary,disabled,style:s}:{children:React.ReactNode;onClick?:()=>void;full?:boolean;secondary?:boolean;disabled?:boolean;style?:any}){return(<button onClick={onClick} disabled={disabled} style={{width:full?'100%':'auto',padding:'12px 20px',borderRadius:10,background:secondary?'transparent':B.blue,border:secondary?'1px solid #ffffff20':'none',color:'#fff',fontSize:13,fontWeight:600,opacity:disabled?0.5:1,cursor:disabled?'not-allowed':'pointer',transition:'all 0.2s',fontFamily:'inherit',...s}}>{children}</button>);}
function Card({children,style:s}:{children:React.ReactNode;style?:any}){return <div style={{background:B.bg,borderRadius:12,border:'1px solid #ffffff08',overflow:'hidden',...s}}>{children}</div>;}
function DRow({l,v,vc}:{l:string;v:string;vc?:string}){return(<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 14px',borderBottom:'1px solid #ffffff06'}}><span style={{fontSize:12,color:'#ffffff60'}}>{l}</span><span style={{fontSize:12,fontWeight:500,color:vc||'#fff',maxWidth:180,textAlign:'right',wordBreak:'break-all'}}>{v}</span></div>);}
function TIcon({s}:{s:string}){const c:Record<string,string>={ETH:'#627eea',SOL:'#14f195',BTC:'#f7931a',BNB:'#f3ba2f',USDT:'#26a17b',USDC:'#2775ca',POL:'#8247e5',AVAX:'#e84142',LINK:'#2a5ada',UNI:'#ff007a',DAI:'#f5ac37'};return(<div style={{width:34,height:34,borderRadius:'50%',background:(c[s]||B.blue)+'25',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:c[s]||B.lightBlue,border:`1px solid ${(c[s]||B.blue)}30`}}>{(s||'?')[0]}</div>);}
function IBtn({onClick,children}:{onClick:()=>void;children:React.ReactNode}){return <button onClick={onClick} style={{background:'none',border:'none',color:'#ffffff60',fontSize:15,padding:4,cursor:'pointer'}}>{children}</button>;}
function Err({children,detail}:{children:React.ReactNode;detail?:string}){
  const [showDetail,setShowDetail]=React.useState(false);
  return <div style={{padding:'10px 12px',borderRadius:10,background:'#7f1d1d20',border:'1px solid #f8717130',marginBottom:10}}>
    <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
      <span style={{fontSize:14,lineHeight:1,flexShrink:0,marginTop:2}}>⚠</span>
      <div style={{flex:1}}>
        <p style={{fontSize:12,color:'#fca5a5',lineHeight:1.5,margin:0}}>{children}</p>
        {detail && detail !== String(children) && <button onClick={()=>setShowDetail(!showDetail)} style={{background:'none',border:'none',color:'#ffffff40',fontSize:10,padding:'4px 0 0',cursor:'pointer',fontFamily:'inherit'}}>{showDetail?'Hide':'Show'} details</button>}
        {showDetail && detail && <pre style={{fontSize:9,color:'#ffffff50',marginTop:4,whiteSpace:'pre-wrap',wordBreak:'break-all',lineHeight:1.4,fontFamily:'monospace'}}>{detail}</pre>}
      </div>
    </div>
  </div>;
}
function Muted({children,mt=0,style:s}:{children:React.ReactNode;mt?:number;style?:any}){return <div style={{fontSize:12,color:'#ffffff60',marginTop:mt,...s}}>{children}</div>;}
function Loader(){return <div style={{width:24,height:24,border:`2px solid ${B.blue}40`,borderTopColor:B.blue,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>;}
function Warn({title,text}:{title:string;text:string}){return(<div style={{background:'#7f1d1d15',border:'1px solid #f8717130',borderRadius:10,padding:12,marginTop:8,marginBottom:8}}><p style={{fontSize:11,color:B.yellow,fontWeight:600,marginBottom:2}}>⚠ {title}</p><p style={{fontSize:11,color:'#ffffff80',lineHeight:1.5}}>{text}</p></div>);}
function SItem({i,l,d,onClick}:{i:string;l:string;d:string;onClick?:()=>void}){return(<button onClick={onClick} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 4px',width:'100%',background:'none',border:'none',borderBottom:'1px solid #ffffff08',color:'#fff',fontFamily:'inherit',cursor:onClick?'pointer':'default',textAlign:'left'}}><span style={{fontSize:18,width:28}}>{i}</span><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{l}</div><Muted mt={0} style={{fontSize:11}}>{d}</Muted></div>{onClick&&<span style={{color:'#ffffff30'}}>›</span>}</button>);}
function QRCode({data,size=180}:{data:string;size?:number}){const cells=25;const cs=size/cells;const h=sHash(data);const bits:boolean[][]=[];for(let y=0;y<cells;y++){bits[y]=[];for(let x=0;x<cells;x++){const tl=x<7&&y<7,tr=x>=cells-7&&y<7,bl=x<7&&y>=cells-7;if(tl||tr||bl){const lx=tr?x-(cells-7):x,ly=bl?y-(cells-7):y;bits[y][x]=lx===0||lx===6||ly===0||ly===6||(lx>=2&&lx<=4&&ly>=2&&ly<=4);}else{const idx=(y*cells+x+h)%256;bits[y][x]=((h>>(idx%32))&1)===1||((x*31+y*17+h)%3===0);}}}return(<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{bits.map((row,y)=>row.map((on,x)=>on?<rect key={`${x}-${y}`} x={x*cs} y={y*cs} width={cs+0.5} height={cs+0.5} fill="#023859"/>:null))}</svg>);}

function sHash(s:string):number{let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return Math.abs(h);}
function fmtVal(v:string):string{if(!v||v==='0'||v==='0x0')return '0';try{const n=parseInt(v,16)/1e18;return n<0.001?'<0.001':n.toFixed(4);}catch{return v;}}
function decMsg(m:string):string{if(m.startsWith('0x')){try{const h=m.slice(2);let s='';for(let i=0;i<h.length;i+=2)s+=String.fromCharCode(parseInt(h.substr(i,2),16));return s;}catch{return m;}}return m;}

const S:Record<string,React.CSSProperties> = {
  root:{width:360,height:600,background:B.navy,overflow:'hidden',display:'flex',flexDirection:'column',color:'#fff',fontFamily:"'Poppins',sans-serif"},
  label:{fontSize:11,color:'#ffffff70',display:'block',marginBottom:4,fontWeight:500},
  input:{width:'100%',padding:'10px 12px',borderRadius:10,background:B.bg,border:'1px solid #ffffff15',color:'#fff',fontSize:13,fontFamily:'inherit'},
  textarea:{width:'100%',padding:12,borderRadius:10,background:B.bg,border:'1px solid #ffffff15',color:'#fff',fontSize:13,resize:'none' as const,fontFamily:'inherit'},
  select:{padding:'8px 12px',borderRadius:8,background:B.bg,border:'1px solid #ffffff20',color:'#fff',fontSize:13,fontFamily:'inherit',cursor:'pointer'},
  chip:{padding:'6px 12px',borderRadius:8,background:'#ffffff08',border:'1px solid #ffffff15',color:'#fff',fontSize:12,cursor:'pointer',fontFamily:'inherit'},
  chainPill:{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:100,background:'#ffffff08',border:'1px solid #ffffff15',color:'#fff',cursor:'pointer',fontFamily:'inherit'},
  addrPill:{display:'flex',alignItems:'center',gap:6,padding:'5px 12px',borderRadius:100,background:`${B.blue}15`,border:`1px solid ${B.blue}25`,color:B.lightBlue,fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:'inherit'},
  actionBtn:{display:'flex',flexDirection:'column' as const,alignItems:'center',gap:4,background:`${B.blue}15`,border:`1px solid ${B.blue}15`,borderRadius:12,padding:'10px 14px',color:'#fff',minWidth:60,cursor:'pointer',fontFamily:'inherit'},
  seedGrid:{background:B.bg,border:'1px solid #ffffff10',borderRadius:12,padding:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:16},
  seedWord:{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',borderRadius:6,background:'#ffffff06'},
  toast:{position:'fixed' as const,top:12,left:'50%',transform:'translateX(-50%)',background:B.green,color:B.black,padding:'8px 20px',borderRadius:100,fontSize:12,fontWeight:600,zIndex:999,boxShadow:'0 4px 20px #00000060'},
};

const CSS = `*{margin:0;padding:0;box-sizing:border-box}input,select,textarea,button{font-family:'Poppins',sans-serif}button{cursor:pointer}input:focus,textarea:focus,select:focus{outline:2px solid ${B.blue}}::selection{background:${B.blue}}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${B.blue}30;border-radius:4px}@keyframes spin{to{transform:rotate(360deg)}}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}`;

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
