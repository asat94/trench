import React, { useEffect, useState } from 'react';
import './rwa-pulse.css';

const chains = [
  { name: 'BNB Chain', short: 'BNB', color: '#f3ba2f', logo: 'bnb-chain.svg' },
  { name: 'Solana', short: 'SOL', color: '#af82ff', logo: 'solana.svg' },
  { name: 'Robinhood Chain', short: 'Robinhood', color: '#3de79a', logo: 'robinhood-chain.jpg' },
  { name: 'Ethereum', short: 'ETH', color: '#a1b5ff', logo: 'ethereum.svg' },
  { name: 'Base', short: 'Base', color: '#478bff', logo: 'base.svg' }
];
const compact = (v, currency = false) => Number.isFinite(v) ? `${currency ? '$' : ''}${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}` : '—';
const dateLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const full = (v, currency = false) => Number.isFinite(v) ? `${currency ? '$' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: currency ? 2 : 0 })}` : 'Unavailable';
function Logo({ chain }) { return <span className="rp-logo"><img src={`/chain-icons/${chain.logo}`} alt="" /></span>; }

function VolumeChart({ data }) {
  const values = chains.map((c) => data?.chains?.find((d) => d.chain === c.name)?.volume ?? null);
  const maximum = Math.max(1, ...values.filter(Number.isFinite)) * 1.12;
  return <div className="rp-scroll"><svg className="rp-plot" viewBox="0 0 880 360" role="img" aria-label="Onchain volume by chain. Vertical axis: US dollars. Horizontal axis: chains.">
    <text className="rp-axis-title" x="85" y="20">Volume (USD)</text>
    {[0, 1, 2, 3, 4].map((i) => <g key={i}><line className="rp-grid" x1="85" x2="860" y1={270 - i * 56} y2={270 - i * 56} /><text className="rp-tick" x="74" y={275 - i * 56} textAnchor="end">{values.some(Number.isFinite) ? compact(maximum * i / 4, true) : '—'}</text></g>)}
    {chains.map((chain, i) => {
      const value = values[i]; const x = 117 + i * 152; const height = Number.isFinite(value) ? value / maximum * 224 : 0;
      return <g key={chain.name}><title>{chain.name}: {full(value, true)}</title>
        {Number.isFinite(value) && <rect x={x} y={270 - height} width="85" height={height} rx="4" fill={chain.color} />}
        <text className="rp-value" x={x + 42} y={Number.isFinite(value) ? 259 - height : 248} textAnchor="middle">{compact(value, true)}</text>
        <text className="rp-tick" x={x + 42} y="298" textAnchor="middle">{chain.short}</text>
        {!Number.isFinite(value) && <text className="rp-missing" x={x + 42} y="319" textAnchor="middle">Unavailable</text>}
      </g>;
    })}
    <text className="rp-axis-title" x="473" y="351" textAnchor="middle">Chain</text>
  </svg></div>;
}

function HoldersChart({ data, visible }) {
  const rows = chains.filter((c) => visible.has(c.name)).map((c) => ({ ...c, history: data?.chains?.find((d) => d.chain === c.name)?.history || [] }));
  const days = [...new Set(rows.flatMap((c) => c.history.map((p) => p.day)))].sort();
  const valid = rows.flatMap((c) => c.history.map((p) => p.holders)).filter(Number.isFinite);
  const max = Math.max(1, ...valid) * 1.1;
  const start = days.length ? Date.parse(days[0]) : 0;
  const end = days.length ? Date.parse(days.at(-1)) : 0;
  const x = (day) => end === start ? 472 : 85 + (Date.parse(day) - start) / (end - start) * 775;
  const y = (value) => 270 - value / max * 224;
  const ticks = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])].filter((i) => i >= 0 && days[i]);
  return <div className="rp-scroll"><svg className="rp-plot" viewBox="0 0 880 360" role="img" aria-label="Holders by chain. Vertical axis: holder addresses. Horizontal axis: UTC dates.">
    <text className="rp-axis-title" x="85" y="20">Holder addresses</text>
    {[0, 1, 2, 3, 4].map((i) => <g key={i}><line className="rp-grid" x1="85" x2="860" y1={270 - i * 56} y2={270 - i * 56} /><text className="rp-tick" x="74" y={275 - i * 56} textAnchor="end">{valid.length ? compact(max * i / 4) : '—'}</text></g>)}
    {rows.map((chain) => {
      let previous = null;
      const path = chain.history.map((point) => {
        if (!Number.isFinite(point.holders)) { previous = null; return ''; }
        const command = previous ? 'L' : 'M'; previous = point;
        return `${command}${x(point.day)},${y(point.holders)}`;
      }).join(' ');
      return <g key={chain.name}><path d={path} fill="none" stroke={chain.color} strokeWidth="3" strokeLinejoin="round" />{chain.history.filter((p) => Number.isFinite(p.holders)).map((p) => <circle key={p.day} cx={x(p.day)} cy={y(p.holders)} r="3.5" fill={chain.color}><title>{chain.name} · {dateLabel(p.day)}: {full(p.holders)} holders</title></circle>)}</g>;
    })}
    {ticks.map((i) => <text key={i} className="rp-tick" x={x(days[i])} y="299" textAnchor={i === 0 && days.length > 1 ? 'start' : i === days.length - 1 && days.length > 1 ? 'end' : 'middle'}>{dateLabel(days[i])}</text>)}
    {!valid.length && <text className="rp-empty" x="472" y="155" textAnchor="middle">{visible.size ? 'Holder history is not available yet' : 'Select a chain below'}</text>}
    <text className="rp-axis-title" x="472" y="349" textAnchor="middle">Date (UTC)</text>
  </svg></div>;
}

export default function RwaPulse() {
  const [market, setMarket] = useState('rwa');
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(() => new Set(chains.map((c) => c.name)));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(null);
    fetch(`/api/rwa?market=${market}&period=${period}`, { signal: controller.signal }).then((r) => r.json()).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((e) => { if (e.name !== 'AbortError') setData({ message: 'Market data is temporarily unavailable.' }); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [market, period]);
  const toggle = (name) => setVisible((old) => { const next = new Set(old); next.has(name) ? next.delete(name) : next.add(name); return next; });
  const coverageText = (key) => loading ? 'Loading…' : data?.coverage?.[key] === 5 ? 'Across five chains' : `${data?.coverage?.[key] || 0} of 5 chains available`;
  return <section className="rp-page" aria-busy={loading}>
    <div className="rp-heading"><div><span className="rp-eyebrow">REAL-WORLD ASSET PULSE</span><h1>RWA Pulse</h1><p>Track where onchain volume and holders are moving.</p></div><span className="rp-status">{loading ? 'Loading' : data?.live ? 'Updated' : data?.available ? 'Partial coverage' : 'Awaiting data'}</span></div>
    <div className="rp-controls"><div aria-label="Asset category">{[['rwa', 'RWA Market'], ['stocks', 'Tokenized Stocks']].map(([key, label]) => <button key={key} aria-pressed={market === key} onClick={() => setMarket(key)}>{label}</button>)}</div><div aria-label="Time range">{['1d', '7d', '30d'].map((key) => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>{key.toUpperCase()}</button>)}</div></div>
    <div className="rp-cards"><article><span>Total Onchain Volume</span><strong>{compact(data?.totals?.volume, true)}</strong><small>{period.toUpperCase()} · {coverageText('volume')}</small></article><article><span>Total Holders</span><strong>{compact(data?.totals?.holders)}</strong><small>Latest daily snapshot · {coverageText('holders')}</small></article></div>
    {data?.message && <p className="rp-notice" role="status">{data.message}</p>}
    <article className="rp-chart"><div className="rp-chart-heading"><h2>Onchain Volume by chain</h2><span>{period.toUpperCase()} · Complete UTC days</span></div><VolumeChart data={data} /><div className="rp-chain-values">{chains.map((c) => <div key={c.name}><Logo chain={c} /><span>{c.name}</span><strong>{compact(data?.chains?.find((d) => d.chain === c.name)?.volume, true)}</strong></div>)}</div></article>
    <article className="rp-chart"><div className="rp-chart-heading"><h2>Holders by chain</h2><span>{period.toUpperCase()} · Daily snapshots</span></div><HoldersChart data={data} visible={visible} /><div className="rp-legend">{chains.map((c) => <button key={c.name} aria-pressed={visible.has(c.name)} onClick={() => toggle(c.name)} style={{ '--chain-color': c.color }}><Logo chain={c} /><span>{c.name}</span><strong>{compact(data?.chains?.find((d) => d.chain === c.name)?.holders)}</strong></button>)}</div></article>
    <p className="rp-footnote">Holders are addresses per chain. The same owner may hold assets on more than one chain.{data?.updated ? ` Updated ${new Date(data.updated).toLocaleString('en-US', { timeZone: 'UTC' })} UTC.` : ''}</p>
  </section>;
}
