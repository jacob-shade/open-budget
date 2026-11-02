use sqlx::{Executor, FromRow, QueryBuilder, Sqlite};

use crate::{db::to_cents, services::plaid};

#[derive(Debug, Clone, FromRow)]
pub struct Transaction {
    pub id: String,
    pub account_id: String,
    pub amount_cents: i64,
    pub iso_currency_code: Option<String>,
    pub date: String,
    pub authorized_date: Option<String>,
    pub name: String,
    pub merchant_name: Option<String>,
    pub category_primary: Option<String>,
    pub category_detailed: Option<String>,
    pub pending: bool,
    pub logo_url: Option<String>,
    /// Joined from `accounts`.
    pub account_name: String,
}

#[derive(Debug, Default)]
pub struct TransactionFilter {
    pub account_id: Option<String>,
    /// Any of these accounts (empty = all).
    pub account_ids: Vec<String>,
    /// Inclusive YYYY-MM-DD bounds.
    pub start: Option<String>,
    pub end: Option<String>,
    /// Case-insensitive text matched against the name and merchant.
    pub search: Option<String>,
    /// Any of these Plaid primary categories (empty = all).
    pub categories: Vec<String>,
    /// Some(true) = money in only, Some(false) = money out only.
    pub money_in: Option<bool>,
    pub limit: i64,
    pub offset: i64,
}

impl Transaction {
    pub async fn upsert_from_plaid<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        t: &plaid::Transaction,
    ) -> sqlx::Result<()> {
        let (primary, detailed) = match &t.personal_finance_category {
            Some(c) => (Some(c.primary.as_str()), Some(c.detailed.as_str())),
            None => (None, None),
        };
        sqlx::query(
            "INSERT INTO transactions (id, account_id, amount_cents, iso_currency_code, date, authorized_date,
                name, merchant_name, category_primary, category_detailed, pending, logo_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                account_id = excluded.account_id,
                amount_cents = excluded.amount_cents,
                iso_currency_code = excluded.iso_currency_code,
                date = excluded.date,
                authorized_date = excluded.authorized_date,
                name = excluded.name,
                merchant_name = excluded.merchant_name,
                category_primary = excluded.category_primary,
                category_detailed = excluded.category_detailed,
                pending = excluded.pending,
                logo_url = excluded.logo_url,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .bind(&t.transaction_id)
        .bind(&t.account_id)
        // Plaid: positive = outflow. Ours: negative = outflow.
        .bind(-to_cents(t.amount))
        .bind(t.iso_currency_code.as_ref().or(t.unofficial_currency_code.as_ref()))
        .bind(&t.date)
        .bind(&t.authorized_date)
        .bind(t.name.as_deref().or(t.merchant_name.as_deref()).unwrap_or("Unknown"))
        .bind(&t.merchant_name)
        .bind(primary)
        .bind(detailed)
        .bind(t.pending)
        .bind(&t.logo_url)
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn delete<'e, E: Executor<'e, Database = Sqlite>>(db: E, id: &str) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM transactions WHERE id = ?").bind(id).execute(db).await?;
        Ok(())
    }

    pub async fn list<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        filter: &TransactionFilter,
    ) -> sqlx::Result<Vec<Transaction>> {
        let mut q = QueryBuilder::<Sqlite>::new(
            "SELECT t.id, t.account_id, t.amount_cents, t.iso_currency_code, t.date, t.authorized_date,
                    t.name, t.merchant_name, t.category_primary, t.category_detailed, t.pending, t.logo_url,
                    a.name AS account_name
             FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE 1=1",
        );
        push_filters(&mut q, filter);
        q.push(" ORDER BY t.date DESC, t.id LIMIT ")
            .push_bind(filter.limit)
            .push(" OFFSET ")
            .push_bind(filter.offset);
        q.build_query_as().fetch_all(db).await
    }
}

/// Adds a filter's conditions to a query over `transactions t JOIN accounts a` that already has a WHERE.
fn push_filters<'a>(q: &mut QueryBuilder<'a, Sqlite>, filter: &'a TransactionFilter) {
    if let Some(account_id) = &filter.account_id {
        q.push(" AND t.account_id = ").push_bind(account_id);
    }
    if !filter.account_ids.is_empty() {
        q.push(" AND t.account_id IN (");
        let mut list = q.separated(", ");
        for id in &filter.account_ids {
        list.push_bind(id);
        }
        q.push(")");
    }
    if let Some(start) = &filter.start {
        q.push(" AND t.date >= ").push_bind(start);
    }
    if let Some(end) = &filter.end {
        q.push(" AND t.date <= ").push_bind(end);
    }
    if let Some(text) = filter.search.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        // Escape LIKE wildcards so "%" or "_" in the search are matched literally.
        let pattern = format!("%{}%", text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        q.push(" AND (t.name LIKE ").push_bind(pattern.clone()).push(" ESCAPE '\\' OR t.merchant_name LIKE ").push_bind(pattern).push(" ESCAPE '\\')");
    }
    if !filter.categories.is_empty() {
        q.push(" AND COALESCE(t.category_primary, '') IN (");
        let mut list = q.separated(", ");
        for c in &filter.categories {
        list.push_bind(c);
        }
        q.push(")");
    }
    match filter.money_in {
        Some(true) => {
        q.push(" AND t.amount_cents > 0");
        }
        Some(false) => {
        q.push(" AND t.amount_cents < 0");
        }
        None => {}
    }
}

/// Categories that move money between your own accounts: neither spending nor income in summaries.
pub const TRANSFER_CATEGORIES: [&str; 3] = ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"];

#[derive(Debug, Default, sqlx::FromRow)]
pub struct TransactionTotals {
    pub count: i64,
    pub spending_cents: i64,
    pub expense_count: i64,
    pub income_cents: i64,
}

#[derive(Debug, sqlx::FromRow)]
pub struct LargestExpense {
    pub id: String,
    pub name: String,
    pub merchant_name: Option<String>,
    pub date: String,
    pub amount_cents: i64,
}

fn push_not_transfer(q: &mut QueryBuilder<'_, Sqlite>) {
    q.push(" COALESCE(t.category_primary, '') NOT IN (");
    let mut list = q.separated(", ");
    for c in TRANSFER_CATEGORIES {
        list.push_bind(c);
    }
    q.push(")");
}

impl Transaction {
    /// Totals over every transaction matching the filter (limit/offset ignored). Spending and income
    /// leave out transfers and card/loan payments, so a card purchase and its payment aren't counted twice.
    pub async fn totals(db: &sqlx::SqlitePool, filter: &TransactionFilter) -> sqlx::Result<(TransactionTotals, Option<LargestExpense>)> {
        let mut q = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND");
        push_not_transfer(&mut q);
        q.push(" THEN -t.amount_cents END), 0) AS spending_cents, COUNT(CASE WHEN t.amount_cents < 0 AND");
        push_not_transfer(&mut q);
        q.push(" THEN 1 END) AS expense_count, COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND");
        push_not_transfer(&mut q);
        q.push(" THEN t.amount_cents END), 0) AS income_cents FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE 1=1");
        push_filters(&mut q, filter);
        let totals: TransactionTotals = q.build_query_as().fetch_one(db).await?;

        let mut q = QueryBuilder::<Sqlite>::new(
            "SELECT t.id, t.name, t.merchant_name, t.date, t.amount_cents
             FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.amount_cents < 0 AND",
        );
        push_not_transfer(&mut q);
        push_filters(&mut q, filter);
        q.push(" ORDER BY t.amount_cents ASC, t.date DESC LIMIT 1");
        let largest: Option<LargestExpense> = q.build_query_as().fetch_optional(db).await?;
        Ok((totals, largest))
    }
}

/// Plaid primary categories that move money rather than spend it.
pub const NON_SPENDING_CATEGORIES: [&str; 4] = ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "INCOME"];

#[derive(Debug, sqlx::FromRow)]
pub struct DailySpending {
    pub date: String,
    pub spent_cents: i64,
}

impl Transaction {
    /// Money spent per day in [start, end] (inclusive, YYYY-MM-DD): outflows across personal accounts,
    /// excluding transfers, loan/credit-card payments and income. Pending transactions count.
    pub async fn daily_spending<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        start: &str,
        end: &str,
    ) -> sqlx::Result<Vec<DailySpending>> {
        let mut q = QueryBuilder::<Sqlite>::new(
            "SELECT t.date, SUM(-t.amount_cents) AS spent_cents
             FROM transactions t JOIN accounts a ON a.id = t.account_id
             WHERE a.business_id IS NULL AND t.amount_cents < 0 AND t.date >= ",
        );
        q.push_bind(start).push(" AND t.date <= ").push_bind(end);
        q.push(" AND COALESCE(t.category_primary, '') NOT IN (");
        let mut list = q.separated(", ");
        for c in NON_SPENDING_CATEGORIES {
            list.push_bind(c);
        }
        q.push(") GROUP BY t.date ORDER BY t.date");
        q.build_query_as().fetch_all(db).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn daily_spending_counts_only_outflows_that_are_spending() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type) VALUES ('a', 'i', 'Checking', 'depository')")
            .execute(&pool)
            .await
            .unwrap();
        let rows = [
            ("t1", -1250, "2026-10-01", Some("FOOD_AND_DRINK")),
            ("t2", -750, "2026-10-01", Some("GENERAL_MERCHANDISE")),
            ("t3", -5000, "2026-10-01", Some("LOAN_PAYMENTS")), // card payment: not spending
            ("t4", -9000, "2026-10-02", Some("TRANSFER_OUT")),  // transfer: not spending
            ("t5", 200000, "2026-10-02", Some("INCOME")),       // money in
            ("t6", -300, "2026-10-03", None),                   // uncategorized outflow counts
            ("t7", -999, "2026-09-30", Some("FOOD_AND_DRINK")), // outside the range
        ];
        for (id, cents, date, cat) in rows {
            sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, category_primary, pending) VALUES (?, 'a', ?, ?, 'x', ?, 0)")
                .bind(id)
                .bind(cents)
                .bind(date)
                .bind(cat)
                .execute(&pool)
                .await
                .unwrap();
        }
        let days = Transaction::daily_spending(&pool, "2026-10-01", "2026-10-31").await.unwrap();
        let got: Vec<(&str, i64)> = days.iter().map(|d| (d.date.as_str(), d.spent_cents)).collect();
        assert_eq!(got, vec![("2026-10-01", 2000), ("2026-10-03", 300)]);

        // An account linked to a business: its outflows are left out of personal spending.
        sqlx::query("INSERT INTO businesses (id, name, kind) VALUES (1, 'Cards', 'collectibles')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type, business_id) VALUES ('b', 'i', 'Biz', 'depository', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, category_primary, pending) VALUES ('b1', 'b', -120000, '2026-10-06', 'x', 'GENERAL_SERVICES', 0)")
            .execute(&pool)
            .await
            .unwrap();
        let personal = Transaction::daily_spending(&pool, "2026-10-01", "2026-10-31").await.unwrap();
        assert_eq!(personal.iter().map(|d| d.spent_cents).sum::<i64>(), 2300, "business outflows leak into personal spending");
    }

    #[tokio::test]
    async fn list_filters_by_date_text_category_account_and_direction() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&pool).await.unwrap();
        for (id, name) in [("a", "Checking"), ("c", "Card")] {
            sqlx::query("INSERT INTO accounts (id, item_id, name, account_type) VALUES (?, 'i', ?, 'depository')").bind(id).bind(name).execute(&pool).await.unwrap();
        }
        let rows = [
            ("t1", "a", -500, "2026-10-01", "STARBUCKS #12", Some("Starbucks"), Some("FOOD_AND_DRINK")),
            ("t2", "c", -2000, "2026-10-05", "AMZN Mktp", Some("Amazon"), Some("GENERAL_MERCHANDISE")),
            ("t3", "a", 250000, "2026-10-15", "ACME PAYROLL", None, Some("INCOME")),
            ("t4", "c", -100, "2026-11-01", "100% Juice_Bar", None, None),
        ];
        for (id, acct, cents, date, name, merchant, cat) in rows {
            sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, merchant_name, category_primary, pending) VALUES (?, ?, ?, ?, ?, ?, ?, 0)")
                .bind(id).bind(acct).bind(cents).bind(date).bind(name).bind(merchant).bind(cat)
                .execute(&pool).await.unwrap();
        }
        let ids = |f: TransactionFilter| {
            let pool = pool.clone();
            async move {
                let mut v: Vec<String> = Transaction::list(&pool, &TransactionFilter { limit: 100, ..f }).await.unwrap().into_iter().map(|t| t.id).collect();
                v.sort();
                v
            }
        };
        assert_eq!(ids(TransactionFilter::default()).await, ["t1", "t2", "t3", "t4"]);
        assert_eq!(ids(TransactionFilter { start: Some("2026-10-02".into()), end: Some("2026-10-31".into()), ..Default::default() }).await, ["t2", "t3"]);
        assert_eq!(ids(TransactionFilter { search: Some("starbucks".into()), ..Default::default() }).await, ["t1"], "case-insensitive");
        assert_eq!(ids(TransactionFilter { search: Some("amazon".into()), ..Default::default() }).await, ["t2"], "matches merchant name");
        assert_eq!(ids(TransactionFilter { search: Some("100%".into()), ..Default::default() }).await, ["t4"], "% is literal");
        assert_eq!(ids(TransactionFilter { search: Some("e_b".into()), ..Default::default() }).await, ["t4"], "_ is literal");
        assert_eq!(ids(TransactionFilter { categories: vec!["FOOD_AND_DRINK".into(), "INCOME".into()], ..Default::default() }).await, ["t1", "t3"]);
        assert_eq!(ids(TransactionFilter { account_ids: vec!["c".into()], ..Default::default() }).await, ["t2", "t4"]);
        assert_eq!(ids(TransactionFilter { money_in: Some(true), ..Default::default() }).await, ["t3"]);
        assert_eq!(ids(TransactionFilter { money_in: Some(false), account_ids: vec!["a".into()], ..Default::default() }).await, ["t1"]);

        // A card payment is neither spending nor income.
        sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, category_primary, pending) VALUES ('t5', 'a', -9000, '2026-10-20', 'CARD PAYMENT', 'LOAN_PAYMENTS', 0)")
            .execute(&pool).await.unwrap();
        let (totals, largest) = Transaction::totals(&pool, &TransactionFilter::default()).await.unwrap();
        assert_eq!((totals.count, totals.spending_cents, totals.expense_count, totals.income_cents), (5, 2600, 3, 250000));
        assert_eq!(largest.map(|l| (l.id, l.amount_cents)), Some(("t2".to_string(), -2000)), "largest is Amazon, not the card payment");
        let (oct, _) = Transaction::totals(&pool, &TransactionFilter { start: Some("2026-10-01".into()), end: Some("2026-10-31".into()), ..Default::default() }).await.unwrap();
        assert_eq!((oct.count, oct.spending_cents), (4, 2500));
    }
}
