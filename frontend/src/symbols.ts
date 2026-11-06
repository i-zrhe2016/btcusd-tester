// USD spot markets; USDT is deliberately not treated as a USD alias.
export const CRYPTO_MARKETS = [
  ['BTCUSD', 'Bitcoin'], ['ETHUSD', 'Ethereum'], ['BNBUSD', 'BNB'],
  ['XRPUSD', 'XRP'], ['SOLUSD', 'Solana'], ['TRXUSD', 'TRON'],
  ['ZECUSD', 'Zcash'], ['HYPEUSD', 'Hyperliquid'], ['DOGEUSD', 'Dogecoin'],
  ['XMRUSD', 'Monero'],
].map(([symbol, name]) => ({ symbol: symbol!, name: name! }))

export function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace('-', '')
}

export function isSupportedSymbol(value: string): boolean {
  return CRYPTO_MARKETS.some((market) => market.symbol === normalizeSymbol(value))
}
