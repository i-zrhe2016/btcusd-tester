pub const SYMBOLS: [&str; 10] = [
    "BTCUSD", "ETHUSD", "BNBUSD", "XRPUSD", "SOLUSD", "TRXUSD", "ZECUSD",
    "HYPEUSD", "DOGEUSD", "XMRUSD",
];

pub fn normalize(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_uppercase().replace('-', "");
    SYMBOLS.iter().copied().find(|symbol| *symbol == normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_ten_usd_markets_and_rejects_other_quotes() {
        for symbol in SYMBOLS {
            assert_eq!(normalize(symbol), Some(symbol));
            let alias = symbol.replace("USD", "-usd").to_lowercase();
            assert_eq!(normalize(&alias), Some(symbol));
        }
        assert_eq!(normalize("BTCUSDT"), None);
        assert_eq!(normalize("UNKNOWNUSD"), None);
    }
}
