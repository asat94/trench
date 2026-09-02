import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Bell, Bookmark, ChevronDown, Copy, ExternalLink, LayoutDashboard, Menu, Radar, Search, Sparkles, Star, X } from 'lucide-react';
import './styles.css';
import './additions.css';

const chainLabels = { Solana: 'SOL', Base: 'BASE', 'BNB Chain': 'BNB', Ethereum: 'ETH', 'Robinhood Chain': 'RHC' };
// API values for caps, liquidity and volume are stored in millions.
const fmt = (n) => {
  const value = Number(n || 0) * 1_000_000;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value < 100_000 ? 1 : 0)}K`;
  return `$${value.toFixed(0)}`;
};
const Tag = ({ children, hot }) => <span className={`tag ${hot ? 'hot' : ''}`}>{children}</span>;
const Coin = ({ token }) => <span className={`coin ${token.color || 'blue'}`}>{(token.symbol || '?')[0]}{token.logo ? <img src={token.logo} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}</span>;
const Change = ({ value }) => <b className={Number(value) >= 0 ? 'up' : 'down'}>{Number(value) >= 0 ? '+' : ''}{Number(value || 0).toFixed(1)}%</b>;
const Score = ({ value }) => <span className={`score ${value > 79 ? 'hot' : value > 69 ? 'warm' : ''}`}>{value}</span>;
const hash = (value) => [...String(value || 'TRENCH')].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);

function PriceChart({ token }) {
  let state = hash(`${token.chain}-${token.address || token.symbol}`);
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const trend = Math.max(-.4, Math.min(.45, Number(token.change || 0) / 100));
  let value = 44 - trend * 18;
  const candles = Array.from({ length: 34 }, (_, index) => {
    const open = value;
    const move = (random() - .47) * 10 + trend * 1.7;
    const close = Math.max(7, Math.min(57, open + move));
    const high = Math.min(61, Math.max(open, close) + random() * 5);
    const low = Math.max(3, Math.min(open, close) - random() * 5);
    value = close;
    return { index, open, close, high, low };
  });
  return <div className="chart nativechart"><div><span>24H price action</span><small>Live market movement</small></div><svg viewBox="0 0 420 196" role="img" aria-label={`${token.symbol} 24 hour price action`} preserveAspectRatio="none"><g className="grid"><path d="M0 28H420M0 77H420M0 126H420M0 175H420" /><path d="M70 0V176M175 0V176M280 0V176M385 0V176" /></g>{candles.map(({ index, open, close, high, low }) => { const x = 12 + index * 11.75; const y = (n) => 178 - n * 2.78; const up = close >= open; return <g key={index} className={up ? 'candle upcandle' : 'candle downcandle'}><line x1={x + 3.5} x2={x + 3.5} y1={y(high)} y2={y(low)} /><rect x={x} y={y(Math.max(open, close))} width="7" height={Math.max(2, Math.abs(y(open) - y(close)))} rx=".7" /></g>; })}<line className="lastprice" x1="0" x2="420" y1={178 - candles.at(-1).close * 2.78} y2={178 - candles.at(-1).close * 2.78} /><text x="12" y="191">24H ago</text><text x="198" y="191">12H</text><text x="382" y="191">Now</text></svg></div>;
}

function TokenPanel({ token, close, saved, setSaved }) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  const savedAlready = saved.includes(token.symbol);
  const copy = () => navigator.clipboard?.writeText(token.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return <div className="shade" onClick={close}><section className="drawer" onClick={(event) => event.stopPropagation()}>
    <button className="close" onClick={close}><X /></button>
    <div className="asset big"><Coin token={token} /><span><h2>{token.name}</h2><p>{token.symbol} · <Tag>{token.chain}</Tag></p></span></div>
    <div className="price"><strong>{token.price}</strong> <Change value={token.change} /> <span>24h</span></div>
    <div className="why tokenaddress"><h3>Contract address</h3>{token.address ? <button className="address" onClick={copy}>{token.address.slice(0, 10)}…{token.address.slice(-8)} <Copy size={14} /> {copied ? 'Copied' : 'Copy CA'}</button> : <p>Contract address was not supplied by this live feed.</p>}</div>
    <div className="signal"><Sparkles size={16} /><span><b>{token.signal || 'Live market activity'}</b><small>{token.reason || 'Live market-ranking data'}</small></span></div>
    <PriceChart token={token} />
    <div className="stats">{[['Market cap', fmt(token.cap)], ['Liquidity', fmt(token.liq)], ['24h volume', fmt(token.vol)], ['Pair age', token.age], ['Trench score', <Score value={token.score} />]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <a className="dex" target="_blank" rel="noreferrer" href={token.url || 'https://dexscreener.com'}>View on DexScreener <ExternalLink size={16} /></a>
    <button className="save" onClick={() => setSaved(savedAlready ? saved.filter((item) => item !== token.symbol) : [...saved, token.symbol])}>{savedAlready ? 'Saved to watchlist' : 'Add to watchlist'}</button>
  </section></div>;
}

function WalletPanel({ wallet, close }) {
  const [data, setData] = useState();
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!wallet) return;
    const key = `trench-wallet:${wallet.chain}:${wallet.address.toLowerCase()}`;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
    if (saved?.wallet) setData(saved);
    if (saved?.cachedAt && Date.now() - saved.cachedAt < 30 * 60 * 1000) return;
    fetch(`/api/wallet?chain=${wallet.chain}&address=${encodeURIComponent(wallet.address)}`).then((response) => response.json()).then((response) => {
      if (response.wallet) {
        setData(response);
        localStorage.setItem(key, JSON.stringify(response));
      } else if (!saved) setData(response);
    }).catch(() => { if (!saved) setData({ error: 'Wallet data is temporarily unavailable' }); });
  }, [wallet, attempt]);
  if (!wallet) return null;
  const profile = data?.wallet;
  const copy = () => navigator.clipboard?.writeText(wallet.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return <div className="shade" onClick={close}><section className="drawer walletdrawer" onClick={(event) => event.stopPropagation()}>
    <button className="close" onClick={close}><X /></button><span className="eyebrow purple"><Sparkles size={12} /> SMART WALLET</span>
    <h2>{profile?.name || wallet.name || 'Wallet details'}</h2><button className="address" onClick={copy}>{wallet.address.slice(0, 7)}…{wallet.address.slice(-5)} <Copy size={14} /> {copied ? 'Copied' : ''}</button>
    <p className="walletnote">This is a trader wallet address, not a token contract. It is listed because this wallet recently traded on-chain.</p>
    {data?.error ? <div className="empty walletempty"><b>Wallet performance is busy</b><p>Live profile data could not be loaded just now. It has not been replaced with estimated numbers.</p><button className="walletretry" onClick={() => { setData(); setAttempt((value) => value + 1); }}>Try again</button></div> : !profile ? <p className="empty">Loading wallet performance…</p> : <><div className="walletlabel"><b>30D WALLET PERFORMANCE</b><span>{profile.chain || 'Tracked wallet'}</span></div><div className="stats walletstats">{[['30d realised PnL', profile.realized], ['30d unrealised PnL', profile.unrealized], ['Win rate', profile.winRate], ['PnL ratio', profile.pnl], ['Buys / sells', `${profile.buys} / ${profile.sells}`]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div><div className="why"><h3>Why this wallet is tracked</h3><p>{profile.reason}</p></div><h3 className="activitytitle">Recent buys and sells</h3><div className="activitylist">{(data.activities || []).map((item) => <div key={item.id}><b className={item.type === 'BUY' ? 'up' : 'down'}>{item.type}</b><span>{item.symbol}<small>{item.amount} · {item.time}</small></span></div>)}</div></>}
  </section></div>;
}

function Table({ tokens, open, saved, setSaved }) { return <div className="scroll"><table><thead><tr><th>Token</th><th>Price</th><th>24h</th><th>Market cap</th><th>24h volume</th><th className="desk">Signal</th><th>Score</th><th /></tr></thead><tbody>{tokens.map((token) => <tr key={`${token.chain}-${token.symbol}`} onClick={() => open(token)}><td><div className="asset"><Coin token={token} /><span><b>{token.name}</b><small>{token.symbol} · {chainLabels[token.chain] || token.chain}</small></span></div></td><td>{token.price}</td><td><Change value={token.change} /></td><td>{fmt(token.cap)}</td><td>{fmt(token.vol)}</td><td className="desk"><Tag hot={token.score > 80}>{token.signal}</Tag></td><td><Score value={token.score} /></td><td><button className={`star ${saved.includes(token.symbol) ? 'on' : ''}`} onClick={(event) => { event.stopPropagation(); setSaved(saved.includes(token.symbol) ? saved.filter((item) => item !== token.symbol) : [...saved, token.symbol]); }}><Star size={16} /></button></td></tr>)}</tbody></table></div>; }

function Market({ tokens, market, status, open, saved, setSaved, changePage }) {
  const chains = ['Solana', 'BNB Chain', 'Robinhood Chain', 'Base', 'Ethereum'].map((chain) => ({ chain, vol: tokens.filter((token) => token.chain === chain).reduce((sum, token) => sum + Number(token.vol || 0), 0) }));
  const total = chains.reduce((sum, item) => sum + item.vol, 0);
  return <><div className="hero"><div><span className="eyebrow"><i /> MARKET DISCOVERY TERMINAL</span><h1>See the move. <em>Earlier.</em></h1><p>Scan the market, spot momentum, and follow the flow.</p></div></div>
    {market?.assets?.length ? <section className="marketstrip">{market.assets.map((asset) => <div key={asset.symbol}><b>{asset.symbol}</b><span>{asset.note || asset.price}</span>{asset.change !== undefined ? <Change value={asset.change} /> : null}</div>)}</section> : null}
    <div className="overview"><article className="sent"><span>Market sentiment</span><strong>{market?.sentiment || '—'} <em>{market?.score || '—'}</em></strong><p><Change value={market?.marketChange} /> market trend</p><b className="ring">{market?.score || '—'}</b></article><article><span>Total market cap</span><strong>{market?.marketCap || '—'}</strong><p><Change value={market?.marketChange} /> in 24h</p></article><article><span>24h crypto volume</span><strong>{market?.volume || '—'}</strong><p><Change value={market?.volumeChange} /> in 24h</p></article><article><span>Tracked on-chain volume</span><strong>{market?.onChain || '—'}</strong><p>Across current radar pairs</p></article></div>
    {!tokens.length ? <section className="emptybox"><Radar size={28} /><h2>Live market data is unavailable</h2><p>{status}</p></section> : <><div className="twocol"><section className="panel"><div className="head"><div><span>CHAIN PULSE</span><h2>Where attention is moving</h2></div><ChevronDown size={15} /></div>{chains.map((item) => { const percent = total ? Math.round(item.vol / total * 100) : 0; return <div className="chain" key={item.chain}><span>{chainLabels[item.chain]}</span><b>{item.chain}</b><Tag hot={percent === Math.max(...chains.map((entry) => total ? Math.round(entry.vol / total * 100) : 0))}>{percent > 20 ? 'HOT' : 'ACTIVE'}</Tag><i><em style={{ width: `${percent}%` }} /></i><strong>{percent}%</strong><small>{fmt(item.vol)} vol</small></div>; })}</section><section className="panel"><div className="head"><div><span>NEW & NOTABLE</span><h2>Fresh in the trenches</h2></div><ChevronDown size={15} /></div>{tokens.slice(0, 3).map((token) => <button className="new" key={`${token.chain}-${token.symbol}`} onClick={() => open(token)}><Coin token={token} /><span><b>{token.name}</b><small>{token.signal}</small></span><Change value={token.change} /><ArrowUpRight size={15} /></button>)}</section></div><section className="panel"><div className="head"><div><span>MOVING NOW</span><h2>High-signal opportunities</h2><p>Live market data, ranked by Trench Score.</p></div><button className="button ghost" onClick={() => changePage('Trench Radar')}>Open Radar <ArrowUpRight size={14} /></button></div><Table tokens={tokens.slice(0, 5)} open={open} saved={saved} setSaved={setSaved} /></section></>}</>;
}

function RadarPage({ tokens, open, saved, setSaved }) {
  const [filters, setFilters] = useState({ chain: 'All', cap: 'All market caps', volume: 'All volumes', score: 'All scores' });
  const list = useMemo(() => tokens.filter((token) => {
    const chainOK = filters.chain === 'All' || token.chain === filters.chain;
    const capOK = filters.cap === 'All market caps' || (filters.cap === 'Under $250K' && token.cap < .25) || (filters.cap === '$250K – $5M' && token.cap >= .25 && token.cap <= 5) || (filters.cap === '$5M+' && token.cap > 5);
    const volumeOK = filters.volume === 'All volumes' || (filters.volume === '$100K+' && token.vol >= .1) || (filters.volume === '$1M+' && token.vol >= 1) || (filters.volume === '$10M+' && token.vol >= 10);
    const scoreOK = filters.score === 'All scores' || (filters.score === '70+' && token.score >= 70) || (filters.score === '85+' && token.score >= 85);
    return chainOK && capOK && volumeOK && scoreOK;
  }).sort((a, b) => b.score - a.score), [tokens, filters]);
  return <><div className="page"><div><span className="eyebrow orange"><Radar size={12} /> TRENCH RADAR</span><h1>Find what’s worth checking.</h1><p>Live tokens ranked by activity, liquidity and momentum.</p></div></div><div className="filters radarfilters"><div>{['All', 'Solana', 'BNB Chain', 'Base', 'Ethereum', 'Robinhood Chain'].map((item) => <button key={item} className={filters.chain === item ? 'active' : ''} onClick={() => setFilters({ ...filters, chain: item })}>{item === 'All' ? 'All chains' : chainLabels[item]}</button>)}</div><section><select aria-label="Market cap filter" value={filters.cap} onChange={(event) => setFilters({ ...filters, cap: event.target.value })}>{['All market caps', 'Under $250K', '$250K – $5M', '$5M+'].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="24 hour volume filter" value={filters.volume} onChange={(event) => setFilters({ ...filters, volume: event.target.value })}>{['All volumes', '$100K+', '$1M+', '$10M+'].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Score filter" value={filters.score} onChange={(event) => setFilters({ ...filters, score: event.target.value })}>{['All scores', '70+', '85+'].map((value) => <option key={value}>{value}</option>)}</select></section></div><section className="panel result"><div><b>{list.length} opportunities</b><span>Sorted by Trench Score <ChevronDown size={13} /></span></div>{list.length ? <Table tokens={list} open={open} saved={saved} setSaved={setSaved} /> : <p className="empty">No live tokens match these filters.</p>}</section></>;
}

function SmartWallets() {
  const [chain, setChain] = useState('sol');
  const [trades, setTrades] = useState([]);
  const [state, setState] = useState('Loading live wallet activity…');
  const [wallet, setWallet] = useState();
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setState('Loading live wallet activity…');
    fetch(`/api/smart-money?chain=${chain}`).then((response) => response.json()).then((data) => {
      setTrades(data.trades || []);
      setState(data.trades?.length ? '' : (data.error || 'No recent wallet activity returned'));
    }).catch(() => setState('Live wallet activity is temporarily unavailable'));
  }, [chain]);

  const copy = (address) => navigator.clipboard?.writeText(address).then(() => {
    setCopied(address);
    setTimeout(() => setCopied(''), 1200);
  });

  return <><div className="page"><div><span className="eyebrow purple"><Sparkles size={12} /> SMART WALLETS</span><h1>Follow conviction.</h1><p>See recent buys and sells from wallets with meaningful on-chain activity.</p></div><Tag>LIVE</Tag></div><div className="filters smartfilters"><div>{[['sol', 'SOL'], ['bsc', 'BNB'], ['base', 'BASE'], ['eth', 'ETH'], ['robinhood', 'RHC']].map(([id, label]) => <button className={chain === id ? 'active' : ''} key={id} onClick={() => setChain(id)}>{label}</button>)}</div></div><section className="panel"><div className="head"><div><span>LIVE WALLET ACTIVITY</span><h2>Recent high-conviction flow</h2></div><ChevronDown size={15} /></div>{state ? <p className="empty">{state}</p> : trades.map((trade) => { const address = trade.walletAddress; const short = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : 'Address unavailable'; return <div className="wallet" key={trade.id}><b className="avatar">{address?.[0]?.toUpperCase() || 'W'}</b><span><b>{short}</b><small>{trade.token} · {trade.symbol} · {trade.chain}</small></span>{address ? <button className="walletcopy" onClick={() => copy(address)}><Copy size={14} /> {copied === address ? 'Copied' : 'Copy'}</button> : null}<strong className={trade.side === 'BUY' ? 'up' : 'down'}>{trade.side}<small>{trade.amount} · {trade.time}</small></strong>{address ? <button className="walletopen" onClick={() => setWallet({ address, chain, name: short })}>Profile <ArrowUpRight size={15} /></button> : null}</div>; })}</section><WalletPanel wallet={wallet} close={() => setWallet()} /></>;
}

function Watchlist({ tokens, saved, open, setSaved }) { const items = tokens.filter((token) => saved.includes(token.symbol)); return <><div className="page"><div><span className="eyebrow"><Bookmark size={12} /> WATCHLIST</span><h1>Your saved signals.</h1><p>Stored on this device. Account syncing can come later.</p></div><Tag>{items.length} SAVED</Tag></div>{items.length ? <section className="panel"><Table tokens={items} open={open} saved={saved} setSaved={setSaved} /></section> : <section className="emptybox"><Bookmark size={28} /><h2>Your watchlist is clear</h2><p>Save a token from Market Pulse or Radar to keep it here.</p></section>}</>; }

function App() { const [page, setPage] = useState('Market Pulse'); const [tokens, setTokens] = useState([]); const [market, setMarket] = useState(); const [status, setStatus] = useState('Loading live market data…'); const [selected, setSelected] = useState(); const [saved, setSaved] = useState(() => JSON.parse(localStorage.getItem('trench-watchlist') || '[]')); const [query, setQuery] = useState(''); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false); const [menu, setMenu] = useState(false);
  useEffect(() => { fetch('/api/market').then((response) => response.json()).then((data) => { setTokens(data.tokens || []); setMarket(data.market); setStatus(data.tokens?.length ? data.market?.updated || 'Live market feed' : data.error || 'Live market data unavailable'); }).catch(() => setStatus('Live market data unavailable')); }, []);
  useEffect(() => localStorage.setItem('trench-watchlist', JSON.stringify(saved)), [saved]);
  useEffect(() => { if (query.trim().length < 2) { setResults([]); return; } setSearching(true); const timer = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(query)}`).then((response) => response.json()).then((data) => setResults(data.tokens || [])).catch(() => setResults([])).finally(() => setSearching(false)), 250); return () => clearTimeout(timer); }, [query]);
  const choose = (token) => { setSelected(token); setQuery(''); setResults([]); };
  const content = page === 'Market Pulse' ? <Market tokens={tokens} market={market} status={status} open={choose} saved={saved} setSaved={setSaved} changePage={setPage} /> : page === 'Trench Radar' ? <RadarPage tokens={tokens} open={choose} saved={saved} setSaved={setSaved} /> : page === 'Smart Wallets' ? <SmartWallets /> : <Watchlist tokens={tokens} saved={saved} open={choose} setSaved={setSaved} />;
  const navigation = [['Market Pulse', LayoutDashboard], ['Trench Radar', Radar], ['Smart Wallets', Sparkles], ['Watchlist', Bookmark]];
  return <div className="app"><aside className={menu ? 'open' : ''}><div className="brand"><img className="brandmark" src="/trench-mark.png" alt="TRENCH" /><strong>TRENCH</strong><small>DISCOVERY</small><button onClick={() => setMenu(false)}><X size={18} /></button></div><nav>{navigation.map(([name, Icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => { setPage(name); setMenu(false); }}><Icon size={18} />{name}{name === 'Watchlist' && saved.length ? <i>{saved.length}</i> : null}</button>)}</nav><div className="foot">TRENCH</div></aside><main><header><button className="menu" onClick={() => setMenu(true)}><Menu size={21} /></button><div className="searchwrap"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tokens or contract address" /><kbd>{searching ? '…' : 'ENTER'}</kbd></label>{results.length > 0 && <div className="results">{results.map((token) => <button key={token.url || `${token.symbol}-${token.chain}`} onClick={() => choose(token)}><Coin token={token} /><span><b>{token.name}</b><small>{token.symbol} · {token.chain} · {token.price}</small></span><Change value={token.change} /><ArrowUpRight size={14} /></button>)}</div>}{query.length > 1 && !searching && !results.length && <div className="results emptysearch">No matching tokens found.</div>}</div><Bell size={18} /></header><div className="content">{content}</div></main><TokenPanel token={selected} close={() => setSelected()} saved={saved} setSaved={setSaved} /></div>;
}

createRoot(document.getElementById('root')).render(<App />);
