//! Budget: income planned vs actual, and spending in the Fundamentals / Future / Fun buckets (stored as fixed/future/fun).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use super::{business::BusinessError, cash_flow, transaction::CATEGORY_JOIN};

pub const BUCKETS: [&str; 3] = ["fixed", "future", "fun"];

#[derive(Debug, Serialize, Deserialize, FromRow, PartialEq, Eq, Clone, Copy)]
pub struct Percentages {
    pub fixed_pct: i64,
    pub future_pct: i64,
    pub fun_pct: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct IncomeRow {
    pub label: String,
    /// "income" (paid into personal accounts) or "payout" (from a business).
    pub source: String,
    /// Planned per month; None if you haven't planned this source. For interest, calculated.
    pub planned_monthly_cents: Option<i64>,
    /// Received in the period.
    pub actual_cents: i64,
    /// Interest rows: the account, its APY and the balance the plan is based on.
    pub account_id: Option<String>,
    pub apy_bps: Option<i64>,
    pub balance_cents: Option<i64>,
}

/// Monthly interest on `balance` at `apy_bps` (simple: balance × rate ÷ 12; never negative).
pub fn monthly_interest(balance_cents: i64, apy_bps: i64) -> i64 {
    ((balance_cents.max(0) as i128 * apy_bps as i128) as f64 / 10_000.0 / 12.0).round() as i64
}

#[derive(Debug, Serialize, FromRow, PartialEq, Eq)]
pub struct CategoryRow {
    pub id: i64,
    pub name: String,
    pub emoji: String,
    pub kind: String,
    pub bucket: Option<String>,
    /// Built-in (Plaid's categories map to it): can be renamed or moved but not deleted.
    pub builtin: bool,
    /// Planned per month; None if not planned.
    pub planned_monthly_cents: Option<i64>,
    /// Money out of personal accounts in this category during the period.
    pub actual_cents: i64,
}

#[derive(Debug, Serialize)]
pub struct Budget {
    pub percentages: Percentages,
    pub income: Vec<IncomeRow>,
    /// Expense and transfer categories (income categories aren't budgeted), in display order.
    pub categories: Vec<CategoryRow>,
}

/// Everything the Budget page shows for [start, end].
pub async fn budget(db: &SqlitePool, start: &str, end: &str) -> sqlx::Result<Budget> {
    let percentages: Percentages = sqlx::query_as("SELECT fixed_pct, future_pct, fun_pct FROM budget_settings WHERE id = 1").fetch_one(db).await?;

    // Actual income uses the same grouping as Cash flow; plans add sources not yet received.
    let flow = cash_flow::cash_flow(db, start, end).await?;
    let plans: Vec<(String, String, i64)> = sqlx::query_as("SELECT source, label, monthly_cents FROM budget_income_plans").fetch_all(db).await?;
    let mut rows: BTreeMap<(String, String), IncomeRow> = BTreeMap::new();
    for i in flow.income {
        rows.insert(
            (i.source.clone(), i.label.clone()),
            IncomeRow { label: i.label, source: i.source, planned_monthly_cents: None, actual_cents: i.cents, account_id: i.account_id, apy_bps: None, balance_cents: None },
        );
    }
    // Interest is planned from each APY account's balance at the end of the day before the period:
    // today's balance minus the account's transactions since then (manual accounts: their balance).
    let interest_accounts: Vec<(String, String, i64, i64)> = sqlx::query_as(&format!(
        "SELECT a.id, {}, a.apy_bps,
                COALESCE(a.current_balance_cents, 0) - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = a.id AND t.date >= ?), 0)
         FROM accounts a WHERE COALESCE(a.apy_bps, 0) > 0 AND a.business_id IS NULL AND a.account_type NOT IN ('credit', 'loan')
         UNION ALL
         SELECT 'manual-' || m.id, {}, m.apy_bps, m.balance_cents FROM manual_accounts m WHERE COALESCE(m.apy_bps, 0) > 0 AND m.business_id IS NULL AND m.account_type NOT IN ('credit', 'loan')",
        super::account::display_name("a", true),
        super::account::display_name("m", false),
    ))
    .bind(start)
    .fetch_all(db)
    .await?;
    for (id, name, apy, balance) in interest_accounts {
        let row = rows.entry(("interest".to_string(), format!("{name} interest"))).or_insert(IncomeRow {
            label: format!("{name} interest"),
            source: "interest".into(),
            planned_monthly_cents: None,
            actual_cents: 0,
            account_id: Some(id.clone()),
            apy_bps: None,
            balance_cents: None,
        });
        row.account_id = Some(id);
        row.apy_bps = Some(apy);
        row.balance_cents = Some(balance);
        row.planned_monthly_cents = Some(monthly_interest(balance, apy));
    }
    for (source, label, monthly) in plans {
        rows.entry((source.clone(), label.clone()))
            .or_insert(IncomeRow { label, source, planned_monthly_cents: None, actual_cents: 0, account_id: None, apy_bps: None, balance_cents: None })
            .planned_monthly_cents = Some(monthly);
    }
    let mut income: Vec<IncomeRow> = rows.into_values().collect();
    income.sort_by(|a, b| {
        let key = |r: &IncomeRow| r.planned_monthly_cents.unwrap_or(0).max(r.actual_cents);
        key(b).cmp(&key(a)).then_with(|| a.label.cmp(&b.label))
    });

    let categories: Vec<CategoryRow> = sqlx::query_as(&format!(
        "SELECT cat.id, cat.name, cat.emoji, cat.kind, cat.bucket, cat.plaid_primary IS NOT NULL AS builtin,
                (SELECT monthly_cents FROM budget_category_plans WHERE category_id = cat.id) AS planned_monthly_cents,
                COALESCE((SELECT SUM(-t.amount_cents) FROM transactions t JOIN accounts a ON a.id = t.account_id {CATEGORY_JOIN}
                          WHERE c.id = cat.id AND a.business_id IS NULL AND t.amount_cents < 0 AND t.date >= ?1 AND t.date <= ?2), 0) AS actual_cents
         FROM categories cat WHERE cat.kind != 'income'
         ORDER BY cat.sort_order, cat.name COLLATE NOCASE"
    ))
    .bind(start)
    .bind(end)
    .fetch_all(db)
    .await?;

    Ok(Budget { percentages, income, categories })
}

pub async fn set_percentages(db: &SqlitePool, p: Percentages) -> Result<Percentages, BusinessError> {
    for v in [p.fixed_pct, p.future_pct, p.fun_pct] {
        if !(0..=100).contains(&v) {
            return Err(BusinessError::Invalid("each bucket must be 0-100%"));
        }
    }
    if p.fixed_pct + p.future_pct + p.fun_pct != 100 {
        return Err(BusinessError::Invalid("the three buckets must add up to 100%"));
    }
    sqlx::query("UPDATE budget_settings SET fixed_pct = ?, future_pct = ?, fun_pct = ? WHERE id = 1")
        .bind(p.fixed_pct)
        .bind(p.future_pct)
        .bind(p.fun_pct)
        .execute(db)
        .await?;
    Ok(p)
}

#[derive(Debug, Deserialize)]
pub struct CategoryPlan {
    pub category_id: i64,
    /// None removes the plan.
    pub monthly_cents: Option<i64>,
}

/// Sets (or with None, removes) the planned monthly spending for a category.
pub async fn set_category_plan(db: &SqlitePool, plan: &CategoryPlan) -> Result<(), BusinessError> {
    let kind: Option<String> = sqlx::query_scalar("SELECT kind FROM categories WHERE id = ?").bind(plan.category_id).fetch_optional(db).await?;
    match kind.as_deref() {
        None => return Err(BusinessError::NotFound),
        Some("income") => return Err(BusinessError::Invalid("plan income on the income table, not as a category")),
        Some(_) => {}
    }
    match plan.monthly_cents {
        Some(c) if c < 0 => Err(BusinessError::Invalid("planned spending can't be negative")),
        Some(c) => {
            sqlx::query(
                "INSERT INTO budget_category_plans (category_id, monthly_cents) VALUES (?, ?)
                 ON CONFLICT(category_id) DO UPDATE SET monthly_cents = excluded.monthly_cents",
            )
            .bind(plan.category_id)
            .bind(c)
            .execute(db)
            .await?;
            Ok(())
        }
        None => {
            sqlx::query("DELETE FROM budget_category_plans WHERE category_id = ?").bind(plan.category_id).execute(db).await?;
            Ok(())
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct IncomePlan {
    pub source: String,
    pub label: String,
    /// None removes the plan.
    pub monthly_cents: Option<i64>,
}

/// Sets (or with monthly_cents = None, removes) the planned monthly income for a source.
pub async fn set_income_plan(db: &SqlitePool, plan: &IncomePlan) -> Result<(), BusinessError> {
    if !matches!(plan.source.as_str(), "income" | "payout") {
        return Err(BusinessError::Invalid("source must be income or payout"));
    }
    let label = plan.label.trim();
    if label.is_empty() || label.chars().count() > 200 {
        return Err(BusinessError::Invalid("income source names must be 1-200 characters"));
    }
    match plan.monthly_cents {
        Some(c) if c < 0 => Err(BusinessError::Invalid("planned income can't be negative")),
        Some(c) => {
            sqlx::query(
                "INSERT INTO budget_income_plans (source, label, monthly_cents) VALUES (?, ?, ?)
                 ON CONFLICT(source, label) DO UPDATE SET monthly_cents = excluded.monthly_cents",
            )
            .bind(&plan.source)
            .bind(label)
            .bind(c)
            .execute(db)
            .await?;
            Ok(())
        }
        None => {
            sqlx::query("DELETE FROM budget_income_plans WHERE source = ? AND label = ?").bind(&plan.source).bind(label).execute(db).await?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn budget_combines_plans_actuals_and_bucket_spending() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type) VALUES ('p', 'i', 'Personal', 'depository')").execute(&db).await.unwrap();
        let savings: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Savings & investing'").fetch_one(&db).await.unwrap();
        let rows = [
            ("t1", 300000, "ACME PAYROLL", Some("Acme Corp"), "INCOME", None),
            ("t2", -120000, "Landlord", None, "RENT_AND_UTILITIES", None),
            ("t3", -4000, "Cafe", None, "FOOD_AND_DRINK", None),
            ("t4", -50000, "To brokerage", None, "TRANSFER_OUT", Some(savings)),
            ("t5", -20000, "Card payment", None, "LOAN_PAYMENTS", None),
        ];
        for (id, cents, name, merchant, cat, cat_id) in rows {
            sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, merchant_name, category_primary, category_id, pending) VALUES (?, 'p', ?, '2026-11-02', ?, ?, ?, ?, 0)")
                .bind(id).bind(cents).bind(name).bind(merchant).bind(cat).bind(cat_id)
                .execute(&db).await.unwrap();
        }
        set_income_plan(&db, &IncomePlan { source: "income".into(), label: "Acme Corp".into(), monthly_cents: Some(320000) }).await.unwrap();
        set_income_plan(&db, &IncomePlan { source: "income".into(), label: "Freelance".into(), monthly_cents: Some(50000) }).await.unwrap();
        assert!(set_income_plan(&db, &IncomePlan { source: "other".into(), label: "x".into(), monthly_cents: Some(1) }).await.is_err());

        let b = budget(&db, "2026-11-01", "2026-11-30").await.unwrap();
        assert_eq!(b.percentages, Percentages { fixed_pct: 50, future_pct: 20, fun_pct: 30 });
        let income: Vec<(&str, Option<i64>, i64)> = b.income.iter().map(|r| (r.label.as_str(), r.planned_monthly_cents, r.actual_cents)).collect();
        assert_eq!(income, vec![("Acme Corp", Some(320000), 300000), ("Freelance", Some(50000), 0)]);

        // A 3.50% savings account: interest planned from the October 31 balance, paid Nov 30.
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type, account_subtype, current_balance_cents, apy_bps) VALUES ('s', 'i', 'Online Savings', 'depository', 'savings', 1029167, 350)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, category_primary, category_detailed, pending) VALUES
            ('i1', 's', 29167, '2026-11-30', 'Interest Paid', 'INCOME', 'INCOME_INTEREST_EARNED', 0),
            ('i0', 's', 2000, '2026-10-31', 'Interest Paid', 'INCOME', 'INCOME_INTEREST_EARNED', 0)")
            .execute(&db)
            .await
            .unwrap();
        let b2 = budget(&db, "2026-11-01", "2026-11-30").await.unwrap();
        let marcus = b2.income.iter().find(|r| r.source == "interest").unwrap();
        // Balance at end of Oct 31 = 1,029,167 − 29,167 (Nov interest) = 1,000,000 → $10,000 × 3.5% ÷ 12 = $29.17.
        assert_eq!((marcus.label.as_str(), marcus.balance_cents, marcus.planned_monthly_cents, marcus.actual_cents), ("High Yield Savings interest", Some(1_000_000), Some(2917), 29167));
        let listed = crate::models::account::Account::all(&db).await.unwrap();
        assert_eq!(listed.iter().find(|a| a.id == "s").unwrap().name, "High Yield Savings");
        // Below 1.00% it keeps its own name.
        sqlx::query("UPDATE accounts SET apy_bps = 50 WHERE id = 's'").execute(&db).await.unwrap();
        let listed = crate::models::account::Account::all(&db).await.unwrap();
        assert_eq!(listed.iter().find(|a| a.id == "s").unwrap().name, "Online Savings");
        // A name you choose wins, survives, and clearing it brings the bank's name back.
        assert!(crate::models::account::Account::set_nickname(&db, "s", Some("  Marcus HYSA ")).await.unwrap());
        let name_of = |list: &Vec<crate::models::account::Account>| list.iter().find(|a| a.id == "s").unwrap().name.clone();
        assert_eq!(name_of(&crate::models::account::Account::all(&db).await.unwrap()), "Marcus HYSA");
        assert!(crate::models::account::Account::set_nickname(&db, "s", Some("")).await.unwrap());
        assert_eq!(name_of(&crate::models::account::Account::all(&db).await.unwrap()), "Online Savings");
        assert!(!crate::models::account::Account::set_nickname(&db, "manual-1", Some("x")).await.unwrap());
        assert!(b2.income.iter().all(|r| r.label != "Interest Paid"), "interest isn't also listed as ordinary income");
        // At 0% APY the account isn't an income source.
        sqlx::query("UPDATE accounts SET apy_bps = 0 WHERE id = 's'").execute(&db).await.unwrap();
        let b0 = budget(&db, "2026-11-01", "2026-11-30").await.unwrap();
        assert!(b0.income.iter().all(|r| r.source != "interest"), "0% APY isn't interest income");
        sqlx::query("DELETE FROM transactions WHERE id IN ('i0', 'i1')").execute(&db).await.unwrap();
        sqlx::query("DELETE FROM accounts WHERE id = 's'").execute(&db).await.unwrap();

        let by_bucket = |bucket: &str| b.categories.iter().filter(|c| c.bucket.as_deref() == Some(bucket)).map(|c| c.actual_cents).sum::<i64>();
        assert_eq!((by_bucket("fixed"), by_bucket("future"), by_bucket("fun")), (120000, 50000, 4000));
        assert!(b.categories.iter().all(|c| c.kind != "income"), "income categories aren't budgeted");
        let card = b.categories.iter().find(|c| c.name == "Card & loan payments").unwrap();
        assert!(card.builtin, "seeded categories are built in");
        assert_eq!((card.bucket.as_deref(), card.actual_cents), (None, 20000));

        // Category plans: set, read back, reject income categories and negatives, remove.
        let rent = b.categories.iter().find(|c| c.name == "Rent & utilities").unwrap().id;
        set_category_plan(&db, &CategoryPlan { category_id: rent, monthly_cents: Some(125000) }).await.unwrap();
        let income_cat: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE kind = 'income' LIMIT 1").fetch_one(&db).await.unwrap();
        assert!(set_category_plan(&db, &CategoryPlan { category_id: income_cat, monthly_cents: Some(1) }).await.is_err());
        assert!(set_category_plan(&db, &CategoryPlan { category_id: rent, monthly_cents: Some(-1) }).await.is_err());
        assert!(matches!(set_category_plan(&db, &CategoryPlan { category_id: 999_999, monthly_cents: Some(1) }).await, Err(BusinessError::NotFound)));
        let planned = |b: &Budget| b.categories.iter().find(|c| c.id == rent).unwrap().planned_monthly_cents;
        assert_eq!(planned(&budget(&db, "2026-11-01", "2026-11-30").await.unwrap()), Some(125000));
        set_category_plan(&db, &CategoryPlan { category_id: rent, monthly_cents: None }).await.unwrap();
        assert_eq!(planned(&budget(&db, "2026-11-01", "2026-11-30").await.unwrap()), None);

        assert!(set_percentages(&db, Percentages { fixed_pct: 60, future_pct: 20, fun_pct: 30 }).await.is_err());
        set_percentages(&db, Percentages { fixed_pct: 55, future_pct: 25, fun_pct: 20 }).await.unwrap();
        set_income_plan(&db, &IncomePlan { source: "income".into(), label: "Freelance".into(), monthly_cents: None }).await.unwrap();
        let b = budget(&db, "2026-11-01", "2026-11-30").await.unwrap();
        assert_eq!(b.percentages.fixed_pct, 55);
        assert_eq!(b.income.len(), 1);
    }

    #[test]
    fn monthly_interest_is_simple_and_never_negative() {
        assert_eq!(monthly_interest(1_200_000, 350), 3500); // $12,000 at 3.5% = $35.00/month
        assert_eq!(monthly_interest(-5000, 350), 0);
        assert_eq!(monthly_interest(1_000_000, 0), 0);
    }
}
