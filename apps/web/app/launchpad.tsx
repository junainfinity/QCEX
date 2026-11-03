"use client";

import { useEffect, useRef, useState } from "react";

const stages = ["Upcoming", "Fundraising", "Allocation", "Ready to list"] as const;
type Stage = (typeof stages)[number];
type Project = {
  id: string; name: string; ticker: string; category: string; stage: Stage;
  description: string; color: string; price: string; target: number;
  raised: number; participants: number; supply: number; cap: number; highlight: string;
};
const projects: Project[] = [
  { id: "orbit", name: "Orbit Network", ticker: "ORBT", category: "Infrastructure", stage: "Fundraising", description: "A fictional execution layer connecting apps across independent chains.", color: "#a995ff", price: "0.08", target: 1000000, raised: 680000, participants: 2840, supply: 12500000, cap: 5000, highlight: "Cross-chain execution" },
  { id: "verdant", name: "Verdant Compute", ticker: "VRDN", category: "AI & Compute", stage: "Fundraising", description: "An imagined marketplace for verifiable, distributed compute workloads.", color: "#53d4a0", price: "0.25", target: 2000000, raised: 2450000, participants: 5126, supply: 8000000, cap: 10000, highlight: "Distributed computing" },
  { id: "tide", name: "Tide Protocol", ticker: "TIDE", category: "DeFi", stage: "Upcoming", description: "A demo liquidity-routing protocol designed around transparent pool analytics.", color: "#61bdf5", price: "0.12", target: 1500000, raised: 0, participants: 0, supply: 12500000, cap: 5000, highlight: "Liquidity discovery" },
  { id: "mosaic", name: "Mosaic Worlds", ticker: "MOS", category: "Gaming", stage: "Upcoming", description: "A fictional creator-owned game world with portable collectibles.", color: "#f4a5bc", price: "0.04", target: 800000, raised: 0, participants: 0, supply: 20000000, cap: 2500, highlight: "Playable digital worlds" },
  { id: "axiom", name: "Axiom Data", ticker: "AXDM", category: "Data", stage: "Allocation", description: "An illustrative data-verification network for independently sourced information.", color: "#f4bb60", price: "0.10", target: 1200000, raised: 2160000, participants: 6740, supply: 12000000, cap: 5000, highlight: "Verifiable data" },
  { id: "lumen", name: "Lumen Mesh", ticker: "LMN", category: "DePIN", stage: "Ready to list", description: "A fictional community-operated connectivity network approaching a mock listing review.", color: "#86d7dc", price: "0.05", target: 600000, raised: 900000, participants: 3210, supply: 12000000, cap: 2500, highlight: "Community connectivity" },
];
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const stageCopy: Record<Stage, string> = {
  Upcoming: "Project discovery and eligibility preview. Subscriptions have not opened.",
  Fundraising: "Explore a simulated commitment and preview how a pro-rata allocation could work.",
  Allocation: "The demo subscription window is closed. Pro-rata allocation and refunds are being illustrated.",
  "Ready to list": "Mock allocation is complete. Listing review is the next step; this token is not tradable on QCEX.",
};

function Allocation({ project }: { project: Project }) {
  const [amount, setAmount] = useState("100");
  // BigInt atoms keep this illustrative calculation exact; never posts to a wallet.
  const valid = /^\d{1,6}(\.\d{1,2})?$/.test(amount) && Number(amount) >= 10 && Number(amount) <= project.cap;
  const cents = valid ? BigInt(Math.round(Number(amount) * 100)) : 0n;
  const totalCents = BigInt(project.raised) * 100n + cents;
  const poolAtoms = BigInt(project.supply) * 100000000n;
  const priceCents = BigInt(Math.round(Number(project.price) * 100));
  const purchaseAtoms = cents * 100000000n / priceCents;
  const shareAtoms = totalCents ? poolAtoms * cents / totalCents : 0n;
  const allocation = purchaseAtoms < shareAtoms ? purchaseAtoms : shareAtoms;
  const usedCents = allocation * priceCents / 100000000n;
  return <section className="lp-calculator" aria-label="Allocation preview">
    <span className="eyebrow">TRY THE DEMO</span>
    <h2>Preview your allocation</h2>
    <p>Illustrative pro-rata estimate using the fixed demo totals. No commitment is submitted and no wallet funds move.</p>
    <label htmlFor="lp-amount">Hypothetical commitment (USDT)</label>
    <input id="lp-amount" type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={!valid} aria-describedby="lp-limits" />
    <small id="lp-limits">10–{number(project.cap)} USDT · up to 2 decimal places</small>
    {!valid && <p role="alert" className="negative">Enter an amount between 10 and {number(project.cap)} USDT.</p>}
    <dl className="lp-estimate" aria-live="polite">
      <div><dt>Estimated tokens</dt><dd data-testid="lp-estimate">{valid ? number(Number(allocation) / 100000000) : "—"} {project.ticker}</dd></div>
      <div><dt>Illustrative unused amount</dt><dd>{valid ? number(Number(cents - usedCents) / 100) : "—"} USDT</dd></div>
    </dl>
    <small>Displayed values are rounded. No guaranteed allocation, rewards or future listing.</small>
  </section>;
}

export default function Launchpad() {
  const [filter, setFilter] = useState<"All" | Stage>("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Project | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selected) detailRef.current?.focus(); }, [selected]);
  const visible = projects.filter(p => (filter === "All" || p.stage === filter) && `${p.name} ${p.ticker} ${p.category}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="content-page launchpad-page">
    <section className="lp-hero">
      <div><span className="eyebrow">QCEX LAUNCHPAD</span><h1>Discover what comes next.</h1><p>Explore emerging ideas, follow their fundraising journey and preview a token allocation before listing.</p><span className="lp-disclosure">Demo projects · Fictional funding figures · No real token sales</span></div>
      <div className="lp-orbit" aria-hidden="true"><span>Q</span><i /><b>EARLY IDEAS. NEW POSSIBILITIES.</b></div>
    </section>
    <div className="lp-summary" aria-label="Demo project overview">
      <div><strong>6</strong><span>Demo projects</span></div><div><strong>2</strong><span>Fundraising now</span></div><div><strong>4</strong><span>Launch stages</span></div><div><strong>USDT</strong><span>Illustrative currency</span></div>
    </div>
    {selected ? <>
      <button className="text-button lp-back" onClick={() => setSelected(null)}>← All projects</button>
      <section ref={detailRef} tabIndex={-1} className="lp-detail panel" aria-label={`${selected.name} details`}>
        <div className="lp-project-heading"><span className="lp-logo" style={{ background: selected.color }}>{selected.ticker.slice(0, 1)}</span><div><span className="eyebrow">{selected.category} · FICTIONAL PROJECT</span><h2>{selected.name} <small>{selected.ticker}</small></h2></div><span className="lp-stage">{selected.stage}</span></div>
        <p>{selected.description}</p>
        <ol className="lp-timeline" aria-label="Fundraising stages">{stages.map((stage, index) => <li key={stage} className={index <= stages.indexOf(selected.stage) ? "reached" : ""} aria-current={stage === selected.stage ? "step" : undefined}><span>{index + 1}</span>{stage}</li>)}</ol>
        <p className="lp-stage-copy">{stageCopy[selected.stage]}</p>
        <dl className="lp-facts"><div><dt>Demo token price</dt><dd>{selected.price} USDT</dd></div><div><dt>Demo sale supply</dt><dd>{number(selected.supply)} {selected.ticker}</dd></div><div><dt>Demo raise target</dt><dd>{number(selected.target)} USDT</dd></div><div><dt>Per-person preview cap</dt><dd>{number(selected.cap)} USDT</dd></div></dl>
        <div className="lp-detail-bottom"><section><h3>How this demo works</h3><p>Browse the project, review the stage and compare the illustrative terms. During Fundraising, use the calculator to preview a pro-rata allocation.</p><h3>Before a real listing</h3><p>Project review, eligibility, audited settlement and token delivery are required. These fictional tokens are not added to your wallet or the trading-pair selector.</p><span className="lp-disclosure">Stages are fixed demo scenarios, not scheduled sales.</span></section>{selected.stage === "Fundraising" ? <Allocation key={selected.id} project={selected} /> : <section className="lp-calculator"><span className="eyebrow">{selected.stage.toUpperCase()}</span><h2>{selected.stage === "Upcoming" ? "A new idea is taking shape." : selected.stage === "Allocation" ? "From commitments to allocations." : "Next stop: listing review."}</h2><p>{stageCopy[selected.stage]}</p><p>No participation is available at this demo stage.</p></section>}</div>
      </section>
    </> : <>
      <div className="lp-toolbar"><div className="lp-filters" role="group" aria-label="Filter launch stage">{(["All", ...stages] as const).map(stage => <button key={stage} aria-pressed={filter === stage} onClick={() => setFilter(stage)}>{stage}</button>)}</div><input aria-label="Search LaunchPad projects" placeholder="Search projects or tokens" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="lp-grid">{visible.map(project => <article className="lp-card panel" key={project.id}>
        <div className="lp-card-top"><span className="lp-logo" style={{ background: project.color }}>{project.ticker.slice(0, 1)}</span><span className={`lp-stage ${project.stage === "Fundraising" ? "live" : ""}`}>{project.stage}</span></div>
        <span className="eyebrow">{project.category}</span><h2>{project.name} <small>{project.ticker}</small></h2><p>{project.description}</p>
        <div className="lp-progress-label"><span>Demo subscription</span><strong>{number(project.raised / project.target * 100)}%</strong></div><progress value={Math.min(project.raised, project.target)} max={project.target} aria-label={`${project.name} demo funding progress`} />
        <div className="lp-raised"><strong>{number(project.raised)} <small>USDT</small></strong><span>of {number(project.target)} target</span></div>
        <dl className="lp-card-facts"><div><dt>Demo price</dt><dd>{project.price} USDT</dd></div><div><dt>Demo participants</dt><dd>{number(project.participants)}</dd></div></dl>
        <button className={project.stage === "Fundraising" ? "primary" : "lp-outline"} onClick={() => setSelected(project)} aria-label={`View ${project.name}`}>{project.stage === "Fundraising" ? "Explore allocation preview" : "View project"} <span aria-hidden="true">↗</span></button>
      </article>)}</div>
      {!visible.length && <div className="lp-empty"><h2>No matching projects</h2><p>Try another name or stage.</p><button className="text-button" onClick={() => { setFilter("All"); setSearch(""); }}>Clear filters</button></div>}
    </>}
  </main>;
}
