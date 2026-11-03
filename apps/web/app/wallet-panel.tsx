"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Asset = { asset: string; total: string; spotAvailable: string; held: string; snapshotPrice: string; usdValue: string; address: string; limit: string };
type Movement = { id: string; asset: string; kind: string; amount: string; state: string; created_at: string };
type Wallet = { totalUsd: string; heldUsd: string; valuation: string; assets: Asset[]; movements: Movement[] };
const usd = (v: string) => Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
const qty = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 8 });
const names: Record<string,string> = {USDT:"Tether",BTC:"Bitcoin",ETH:"Ethereum",SOL:"Solana"};
async function loadWallet(): Promise<Wallet> {
  const r=await fetch('/api/wallet',{cache:'no-store'}); const b=await r.json();
  if(!r.ok)throw Error(b.error || 'Wallet unavailable');return b;
}

function WalletAction({asset,kind,close,complete}:{asset:Asset;kind:'deposit'|'withdraw';close:()=>void;complete:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [amount,setAmount]=useState(asset.asset==='USDT'?'100':asset.asset==='BTC'?'0.001':'0.1');
  const [address,setAddress]=useState(`QCEX-SIM-${asset.asset}-demo-destination`);
  const [code,setCode]=useState('123456');
  const [review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const pending=useRef<{fingerprint:string;id:string}|null>(null);
  const submitting=useRef(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function submit(e:FormEvent) {
    e.preventDefault();if(submitting.current)return;
    if(kind==='withdraw' && !review){setReview(true);setError('');return;}
    const data={asset:asset.asset,amount,network:'QCEX-SIM',address,demoCode:code};
    const fingerprint=JSON.stringify(data);
    if(!pending.current || pending.current.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};
    submitting.current=true;setBusy(true);setError('');
    try {
      const r=await fetch(`/api/wallet/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,commandId:pending.current.id}),signal:AbortSignal.timeout(15000)});
      const b=await r.json();if(!r.ok)throw Error(b.error || 'Request failed');
      setSuccess(`Simulated ${kind==='deposit'?'deposit':'withdrawal'} completed. Reference: ${b.id}`);
      await complete();
    } catch(e) {setError(e instanceof Error?e.message:'Request failed. Retry with the same details.');}
    finally{submitting.current=false;setBusy(false);}
  }
  return <dialog ref={dialog} className="modal wallet-dialog" onCancel={e=>{if(busy)e.preventDefault();else close();}} onClose={close}>
    <div className="modal-heading"><h2>{kind==='deposit'?'Deposit':'Withdraw'} {asset.asset}</h2><button aria-label="Close wallet dialog" disabled={busy} onClick={close}>×</button></div>
    <p className="wallet-demo-label">Simulation only. Never send real crypto to these addresses.</p>
    {success ? <><p role="status">{success}</p><button className="primary" onClick={close}>Done</button></> : <form onSubmit={submit}>
      <label>Network<select aria-label="Wallet network" disabled={review}><option value="QCEX-SIM">QCEX simulation network</option></select></label>
      {kind==='deposit'?<label>Demo deposit address<input readOnly value={asset.address} onFocus={e=>e.target.select()} /><small>Select and copy this simulation identifier. It is not a blockchain address.</small></label>:<label>Demo destination<input value={address} onChange={e=>setAddress(e.target.value)} readOnly={review} required pattern={`QCEX-SIM-${asset.asset}-[a-zA-Z0-9-]{3,64}`} /><small>Use QCEX-SIM-{asset.asset}-demo-destination. Real addresses are not accepted.</small></label>}
      <label>Amount ({asset.asset})<input aria-label="Wallet amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} readOnly={review} required pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?" /></label>
      <p className="muted">Available in Spot: {qty(asset.spotAvailable)} {asset.asset} · Per-operation cap: {qty(asset.limit)}</p>
      <dl className="wallet-review"><div><dt>Network fee</dt><dd>0 {asset.asset} (demo)</dd></div><div><dt>{kind==='deposit'?'Credit to':'Debit from'}</dt><dd>Spot wallet</dd></div><div><dt>Settlement</dt><dd>Instant simulation · no blockchain</dd></div></dl>
      {review && <><p>Review {amount} {asset.asset} to the demo destination above.</p><label>Demo verification code<input value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} /><small>123456 · fixed demonstration code, not real MFA.</small></label></>}
      {error && <p role="alert" className="negative">{error}</p>}
      <button className="primary" disabled={busy}>{busy?'Processing…':kind==='deposit'?'Simulate deposit':review?'Confirm simulated withdrawal':'Review withdrawal'}</button>
      {review && <button type="button" className="text-button" disabled={busy} onClick={()=>setReview(false)}>Edit details</button>}
    </form>}
  </dialog>;
}

export default function WalletPanel({revision,onChange}:{revision:unknown;onChange:()=>Promise<void>}) {
  const [wallet,setWallet]=useState<Wallet|null>(null),[error,setError]=useState('');
  const [action,setAction]=useState<{asset:Asset;kind:'deposit'|'withdraw'}|null>(null);
  const refresh=useCallback(async()=>{const data=await loadWallet();setWallet(data);setError('');},[]);
  useEffect(()=>{let active=true;loadWallet().then(data=>{if(active){setWallet(data);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[revision]);
  if(!wallet)return <section className="panel wallet-loading" role="status">{error||'Loading wallet…'}{error&&<button className="text-button" onClick={()=>refresh().catch(e=>setError(e.message))}>Retry</button>}</section>;
  return <section aria-label="Wallet overview" className="wallet-overview">
    <div className="wallet-summary"><div className="panel"><small>Total asset value</small><strong data-testid="wallet-total">{usd(wallet.totalUsd)}</strong><span>Across Spot, Funding and Earn</span></div><div className="panel"><small>Held / subscribed</small><strong>{usd(wallet.heldUsd)}</strong><span>Already included in total assets</span></div><div className="panel"><small>Valuation mode</small><strong className="gold">Demo snapshot</strong><span>Not live market prices</span></div></div>
    <p className="wallet-demo-label">{wallet.valuation}</p>
    {error&&<p role="alert" className="negative">{error}</p>}
    <div className="panel table-scroll"><table className="app-table wallet-assets"><thead><tr><th>Asset</th><th>Total balance</th><th>Snapshot value</th><th>Spot available</th><th>Actions</th></tr></thead><tbody>{wallet.assets.map(asset=><tr key={asset.asset}><td><strong>{asset.asset}</strong><span className="muted"> {names[asset.asset]}</span></td><td>{qty(asset.total)}</td><td>{usd(asset.usdValue)}</td><td>{qty(asset.spotAvailable)}</td><td><div className="wallet-actions"><button className="text-button" aria-label={`Deposit ${asset.asset}`} onClick={()=>setAction({asset,kind:'deposit'})}>Deposit</button><button className="text-button" aria-label={`Withdraw ${asset.asset}`} onClick={()=>setAction({asset,kind:'withdraw'})}>Withdraw</button></div></td></tr>)}</tbody></table></div>
    <h2 className="section-title">Deposit & withdrawal history</h2>
    <div className="panel table-scroll"><table className="app-table"><thead><tr><th>Time</th><th>Type</th><th>Asset</th><th>Amount</th><th>Status</th></tr></thead><tbody>{wallet.movements.map(m=><tr key={m.id}><td>{m.created_at}</td><td>{m.kind}</td><td>{m.asset}</td><td>{qty(m.amount)}</td><td>Simulated completed</td></tr>)}</tbody></table>{!wallet.movements.length&&<p className="wallet-loading">No simulated movements yet. Try a deposit or withdrawal.</p>}</div>
    {action&&<WalletAction {...action} close={()=>setAction(null)} complete={async()=>{await refresh();await onChange();}} />}
  </section>;
}
