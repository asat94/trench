const ENDPOINT = 'https://streaming.bitquery.io/graphql';
export class BitqueryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export async function bitquery(query, variables, signal) {
  const token = process.env.BITQUERY_ACCESS_TOKEN?.trim();
  if (!token) throw new BitqueryError('key_missing');
  const response = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }), signal
  });
  if (!response.ok) throw new BitqueryError(response.status === 401 ? 'authentication' : response.status === 403 ? 'access' : response.status === 429 ? 'rate_limit' : 'upstream');
  const body = await response.json();
  if (body.errors?.length) {
    // Never forward upstream messages: they can contain request details or credentials.
    const message = body.errors.map((e) => String(e.message)).join(' ').toLowerCase();
    throw new BitqueryError(/point|quota|limit|credit/.test(message) ? 'rate_limit' : /permission|authoriz|access|plan/.test(message) ? 'access' : 'query');
  }
  if (!body.data) throw new BitqueryError('empty_response');
  return body.data;
}

export function volumeQuery(network) {
  const solana = network === 'solana';
  const field = solana ? 'MintAddress' : 'SmartContract';
  const root = solana ? 'Solana(dataset: archive)' : `EVM(network: ${network}, dataset: archive)`;
  const success = solana ? 'Transaction: {Success: true}' : 'TransactionStatus: {Success: true}';
  return `query TrenchVolume($tokens: [String!]!, $from: DateTime!, $to: DateTime!) {
    chain: ${root} {
      days: DEXTradeByTokens(limit: {count: 32}, orderBy: {ascending: Block_Date}, where: {
        Block: {Time: {since: $from, before: $to}}, ${success},
        Trade: {Currency: {${field}: {in: $tokens}}}
      }) {
        Block {Date}
        volume: sum(of: Trade_AmountInUSD)
        internal: sum(of: Trade_AmountInUSD, if: {Trade: {Side: {Currency: {${field}: {in: $tokens}}}}})
        trades: count
      }
    }
  }`;
}

export function holdersQuery(network, days) {
  // Archive snapshots deduplicate addresses across the entire selected token set.
  // Solana BalanceUpdates has short retention and cannot supply this holder total.
  if (network === 'solana') return null;
  return `query TrenchHolders($tokens: [String!]!) {
    chain: EVM(network: ${network}, dataset: archive) {
      ${days.map((day, i) => `d${i}: Holders(date: "${day}", where: {Currency: {SmartContract: {in: $tokens}}}) {
        holders: uniq(of: Holder_Address, if: {Balance: {Amount: {gt: "0"}}})
      }`).join('\n')}
    }
  }`;
}

const numeric = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function parseVolume(data, days) {
  const rows = data?.chain?.days;
  if (!Array.isArray(rows) || rows.length > 31) throw new BitqueryError('invalid_volume');
  const result = new Map();
  for (const row of rows) {
    const day = row.Block?.Date;
    if (!days.includes(day) || result.has(day)) throw new BitqueryError('invalid_volume');
    const volume = numeric(row.volume), internal = numeric(row.internal);
    if (volume === null || internal === null || internal > volume) throw new BitqueryError('invalid_volume');
    // Both sides appear when two tracked tokens trade with one another.
    result.set(day, volume - internal / 2);
  }
  // Missing rows remain unknown until the provider's indexing coverage is verified.
  return result;
}
export function parseHolders(data, days) {
  return new Map(days.map((day, i) => {
    const rows = data?.chain?.[`d${i}`];
    const value = Array.isArray(rows) && rows.length === 1 ? numeric(rows[0].holders) : null;
    return [day, Number.isSafeInteger(value) ? value : null];
  }));
}
