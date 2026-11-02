//! Money rules for the collectibles business, kept free of database code so they can be tested.

/// Splits `total` cents across items in proportion to `weights` (their estimated values), so the
/// parts always add up to exactly `total`. Leftover cents from rounding go to the largest
/// remainders. If every weight is zero, the total is split evenly.
pub fn allocate(total: i64, weights: &[i64]) -> Vec<i64> {
    let n = weights.len();
    if n == 0 {
        return Vec::new();
    }
    let weights: Vec<i128> = if weights.iter().all(|w| *w <= 0) { vec![1; n] } else { weights.iter().map(|w| (*w).max(0) as i128).collect() };
    let sum: i128 = weights.iter().sum();
    let total_i = total as i128;
    let mut parts: Vec<i64> = weights.iter().map(|w| (total_i * w / sum) as i64).collect();
    let mut leftover = total - parts.iter().sum::<i64>();
    // Largest remainder first (ties: earlier item first).
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| std::cmp::Reverse((total_i * weights[i]) % sum));
    for &i in order.iter().cycle() {
        if leftover == 0 {
            break;
        }
        parts[i] += 1;
        leftover -= 1;
    }
    parts
}

/// How a trade is accounted for.
#[derive(Debug, PartialEq, Eq)]
pub struct TradeBasis {
    /// Total cost basis given to the items you receive (split across them by estimated value).
    pub incoming_cost: i64,
    /// Profit recognised now: cash received beyond the cost of what you gave up.
    pub gain: i64,
}

/// Items received take over the cost of what you gave (items' cost + cash you added − cash you
/// received). A trade only shows profit when you receive more cash than all of that; the excess
/// is the gain, and the incoming items then have zero cost.
pub fn trade_basis(outgoing_cost: i64, cash_out: i64, cash_in: i64) -> TradeBasis {
    let net = outgoing_cost + cash_out - cash_in;
    if net >= 0 { TradeBasis { incoming_cost: net, gain: 0 } } else { TradeBasis { incoming_cost: 0, gain: -net } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocate_is_proportional_and_exact() {
        assert_eq!(allocate(10000, &[3000, 1000]), vec![7500, 2500]);
        // 100 cents over three equal weights: rounding leftovers still add up.
        let parts = allocate(100, &[1, 1, 1]);
        assert_eq!(parts.iter().sum::<i64>(), 100);
        assert!(parts.iter().all(|p| *p == 33 || *p == 34));
        // No estimated values: even split.
        assert_eq!(allocate(1000, &[0, 0]), vec![500, 500]);
        assert_eq!(allocate(0, &[5, 5]), vec![0, 0]);
        assert!(allocate(500, &[]).is_empty());
        // Big numbers don't overflow.
        assert_eq!(allocate(i64::MAX / 2, &[i64::MAX / 4, i64::MAX / 4]).iter().sum::<i64>(), i64::MAX / 2);
    }

    #[test]
    fn trade_basis_carries_cost_and_recognises_cash_gain() {
        // Gave a $50-cost card plus $20 cash: incoming items cost $70.
        assert_eq!(trade_basis(5000, 2000, 0), TradeBasis { incoming_cost: 7000, gain: 0 });
        // Gave a $50-cost card, got a card plus $30: incoming cost $20.
        assert_eq!(trade_basis(5000, 0, 3000), TradeBasis { incoming_cost: 2000, gain: 0 });
        // Gave a $50-cost card, got a card plus $80: $30 profit now, incoming cost $0.
        assert_eq!(trade_basis(5000, 0, 8000), TradeBasis { incoming_cost: 0, gain: 3000 });
    }
}
