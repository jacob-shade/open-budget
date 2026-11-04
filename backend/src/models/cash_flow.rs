//! Personal cash flow for a period: where money came from and which categories it went to.
//!
//! Only personal accounts count. A business's own income stays within the business; the only
//! business money that counts as personal income is what you recorded as a payout.

use serde::Serialize;
use sqlx::{FromRow, SqlitePool};

use super::transaction::CATEGORY_JOIN;

/// Interest paid into an account you set an APY above 0% for: money in, named or categorised as interest.
pub const IS_INTEREST: &str = "(COALESCE(a.apy_bps, 0) > 0 AND a.account_type NOT IN ('credit', 'loan') AND t.amount_cents > 0
    AND (t.category_detailed = 'INCOME_INTEREST_EARNED' OR LOWER(t.name) LIKE '%interest%'))";

#[derive(Debug, Serialize, FromRow, PartialEq, Eq)]
pub struct IncomeStream {
    /// Who paid you (merchant or transaction name), or the business name for payouts.
    pub label: String,
    /// "income" for deposits into personal accounts, "payout" for business payouts, "interest" for
    /// interest on accounts you set an APY for.
    pub source: String,
    pub business_id: Option<i64>,
    /// The account, for interest.
    pub account_id: Option<String>,
    pub cents: i64,
}

#[derive(Debug, Serialize, FromRow, PartialEq, Eq)]
pub struct CategoryFlow {
    pub category_id: i64,
    pub name: String,
    pub emoji: String,
    pub cents: i64,
}

#[derive(Debug, Serialize)]
pub struct CashFlow {
    /// Largest first.
    pub income: Vec<IncomeStream>,
    /// Largest first.
    pub spending: Vec<CategoryFlow>,
    pub total_income_cents: i64,
    pub total_spending_cents: i64,
}

/// Income streams and spending by category in [start, end] (YYYY-MM-DD, inclusive).
pub async fn cash_flow(db: &SqlitePool, start: &str, end: &str) -> sqlx::Result<CashFlow> {
    let mut income: Vec<IncomeStream> = sqlx::query_as(&format!(
        "SELECT COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.name) AS label, 'income' AS source,
                NULL AS business_id, NULL AS account_id, SUM(t.amount_cents) AS cents
         FROM transactions t JOIN accounts a ON a.id = t.account_id {CATEGORY_JOIN}
         WHERE a.business_id IS NULL AND c.kind = 'income' AND t.amount_cents > 0 AND NOT {IS_INTEREST}
           AND t.date >= ?1 AND t.date <= ?2
         GROUP BY label
         UNION ALL
         SELECT {name} || ' interest', 'interest', NULL, a.id, SUM(t.amount_cents)
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.business_id IS NULL AND {IS_INTEREST} AND t.date >= ?1 AND t.date <= ?2
         GROUP BY a.id",
        name = super::account::display_name("a", true)
    ))
    .bind(start)
    .bind(end)
    .fetch_all(db)
    .await?;
    let payouts: Vec<IncomeStream> = sqlx::query_as(
        "SELECT b.name AS label, 'payout' AS source, b.id AS business_id, NULL AS account_id, SUM(p.amount_cents) AS cents
         FROM business_payouts p JOIN businesses b ON b.id = p.business_id
         WHERE p.date >= ? AND p.date <= ? GROUP BY b.id",
    )
    .bind(start)
    .bind(end)
    .fetch_all(db)
    .await?;
    income.extend(payouts);
    income.sort_by(|a, b| b.cents.cmp(&a.cents).then_with(|| a.label.cmp(&b.label)));

    let spending: Vec<CategoryFlow> = sqlx::query_as(&format!(
        "SELECT c.id AS category_id, c.name, c.emoji, SUM(-t.amount_cents) AS cents
         FROM transactions t JOIN accounts a ON a.id = t.account_id {CATEGORY_JOIN}
         WHERE a.business_id IS NULL AND c.kind = 'expense' AND t.amount_cents < 0 AND t.date >= ? AND t.date <= ?
         GROUP BY c.id ORDER BY cents DESC, c.name"
    ))
    .bind(start)
    .bind(end)
    .fetch_all(db)
    .await?;

    Ok(CashFlow {
        total_income_cents: income.iter().map(|i| i.cents).sum(),
        total_spending_cents: spending.iter().map(|s| s.cents).sum(),
        income,
        spending,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn personal_income_payouts_and_spending() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO businesses (id, name, kind) VALUES (1, 'Card Shop', 'collectibles')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type, business_id) VALUES ('p', 'i', 'Personal', 'depository', NULL), ('b', 'i', 'Biz', 'depository', 1)")
            .execute(&db)
            .await
            .unwrap();
        let rows = [
            ("t1", "p", 300000, "2026-10-01", "ACME PAYROLL", Some("Acme Corp"), "INCOME"),
            ("t2", "p", 300000, "2026-10-15", "ACME PAYROLL", Some("Acme Corp"), "INCOME"),
            ("t3", "p", 5000, "2026-10-20", "Venmo cashout", None, "INCOME"),
            ("t4", "p", 40000, "2026-10-21", "From Biz account", None, "TRANSFER_IN"), // the bank side of a payout: not income
            ("t5", "b", 90000, "2026-10-05", "Customer payment", None, "INCOME"),      // stays in the business
            ("t6", "p", -2500, "2026-10-06", "Cafe", None, "FOOD_AND_DRINK"),
            ("t7", "p", -1500, "2026-10-07", "Diner", None, "FOOD_AND_DRINK"),
            ("t8", "p", -9000, "2026-10-08", "Gas", None, "TRANSPORTATION"),
            ("t9", "p", -50000, "2026-10-09", "Card payment", None, "LOAN_PAYMENTS"),  // transfer: not spending
            ("t10", "b", -7000, "2026-10-09", "Sleeves", None, "GENERAL_MERCHANDISE"), // business spending
            ("t11", "p", -100, "2026-11-01", "Later", None, "FOOD_AND_DRINK"),         // outside the period
        ];
        for (id, acct, cents, date, name, merchant, cat) in rows {
            sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, merchant_name, category_primary, pending) VALUES (?, ?, ?, ?, ?, ?, ?, 0)")
                .bind(id).bind(acct).bind(cents).bind(date).bind(name).bind(merchant).bind(cat)
                .execute(&db).await.unwrap();
        }
        sqlx::query("INSERT INTO business_payouts (business_id, date, amount_cents, paid_via) VALUES (1, '2026-10-21', 40000, 'bank'), (1, '2026-11-02', 999, 'cash')")
            .execute(&db)
            .await
            .unwrap();

        let f = cash_flow(&db, "2026-10-01", "2026-10-31").await.unwrap();
        let income: Vec<(&str, &str, i64)> = f.income.iter().map(|i| (i.label.as_str(), i.source.as_str(), i.cents)).collect();
        assert_eq!(income, vec![("Acme Corp", "income", 600000), ("Card Shop", "payout", 40000), ("Venmo cashout", "income", 5000)]);
        let spending: Vec<(&str, i64)> = f.spending.iter().map(|s| (s.name.as_str(), s.cents)).collect();
        assert_eq!(spending, vec![("Transportation", 9000), ("Food & drink", 4000)]);
        assert_eq!((f.total_income_cents, f.total_spending_cents), (645000, 13000));
    }
}
