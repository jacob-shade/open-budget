use sqlx::{Executor, FromRow, Sqlite};

use crate::{db::to_cents, services::plaid};

#[derive(Debug, Clone, FromRow)]
pub struct Account {
    pub id: String,
    pub item_id: String,
    pub name: String,
    pub official_name: Option<String>,
    pub mask: Option<String>,
    pub account_type: String,
    pub account_subtype: Option<String>,
    pub current_balance_cents: Option<i64>,
    pub available_balance_cents: Option<i64>,
    pub credit_limit_cents: Option<i64>,
    pub iso_currency_code: Option<String>,
    pub updated_at: String,
    /// The business this account belongs to, if any; its money is left out of personal spending.
    pub business_id: Option<i64>,
    /// Joined from `items` (or entered, for manual accounts).
    pub institution_name: Option<String>,
    /// Entered by hand rather than linked through Plaid (id is "manual-<n>").
    pub is_manual: bool,
    /// Interest rate you entered, in basis points (3.50% = 350): APY for savings, APR for debts.
    pub apy_bps: Option<i64>,
    /// Minimum monthly payment (manual loans and credit cards).
    pub min_payment_cents: Option<i64>,
}

/// Prefix of the ids manual accounts are listed under, so they can't collide with Plaid's.
pub const MANUAL_PREFIX: &str = "manual-";

/// APY (basis points) at or above which a savings account is called a high-yield savings account.
pub const HIGH_YIELD_MIN_BPS: i64 = 100;

/// SQL for the name to show for the account aliased `a`: a name you chose (`accounts` only, pass
/// `nickname: true`), else "High Yield Savings" for a savings account earning 1.00% APY or more,
/// else the account's own name.
pub fn display_name(a: &str, nickname: bool) -> String {
    let automatic = format!(
        "(CASE WHEN {a}.account_type = 'depository' AND LOWER(TRIM(COALESCE({a}.account_subtype, ''))) = 'savings' \
         AND COALESCE({a}.apy_bps, 0) >= {HIGH_YIELD_MIN_BPS} THEN 'High Yield Savings' ELSE {a}.name END)"
    );
    if nickname { format!("COALESCE(NULLIF(TRIM({a}.nickname), ''), {automatic})") } else { automatic }
}

impl Account {
    pub async fn upsert_from_plaid<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        item_id: &str,
        a: &plaid::Account,
    ) -> sqlx::Result<()> {
        let b = &a.balances;
        sqlx::query(
            "INSERT INTO accounts (id, item_id, name, official_name, mask, account_type, account_subtype,
                current_balance_cents, available_balance_cents, credit_limit_cents, iso_currency_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                official_name = excluded.official_name,
                mask = excluded.mask,
                account_type = excluded.account_type,
                account_subtype = excluded.account_subtype,
                current_balance_cents = excluded.current_balance_cents,
                available_balance_cents = excluded.available_balance_cents,
                credit_limit_cents = excluded.credit_limit_cents,
                iso_currency_code = excluded.iso_currency_code,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .bind(&a.account_id)
        .bind(item_id)
        .bind(&a.name)
        .bind(&a.official_name)
        .bind(&a.mask)
        .bind(&a.account_type)
        .bind(&a.subtype)
        .bind(b.current.map(to_cents))
        .bind(b.available.map(to_cents))
        .bind(b.limit.map(to_cents))
        .bind(b.iso_currency_code.as_ref().or(b.unofficial_currency_code.as_ref()))
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn all<'e, E: Executor<'e, Database = Sqlite>>(db: E) -> sqlx::Result<Vec<Account>> {
        sqlx::query_as(&format!(
            "SELECT * FROM (
                SELECT a.id, a.item_id, {} AS name, a.official_name, a.mask, a.account_type, a.account_subtype,
                       a.current_balance_cents, a.available_balance_cents, a.credit_limit_cents, a.iso_currency_code,
                       a.updated_at, a.business_id, i.institution_name, 0 AS is_manual, a.apy_bps, NULL AS min_payment_cents
                FROM accounts a JOIN items i ON i.id = a.item_id
                UNION ALL
                SELECT 'manual-' || m.id, '', {}, NULL, NULL, m.account_type, m.account_subtype,
                       m.balance_cents, NULL, NULL, 'USD', m.updated_at, m.business_id, m.institution_name, 1, m.apy_bps, m.min_payment_cents
                FROM manual_accounts m
             ) ORDER BY institution_name, account_type, name",
            display_name("a", true),
            display_name("m", false),
        ))
        .fetch_all(db)
        .await
    }

    /// Links an account to a business (or unlinks it with None). Returns false if no such account exists.
    /// Sets (or with None clears) the name you chose for a linked account. Returns false if there's
    /// no such linked account (manual accounts are renamed through their own update).
    pub async fn set_nickname(db: &sqlx::SqlitePool, id: &str, nickname: Option<&str>) -> sqlx::Result<bool> {
        let nickname = nickname.map(str::trim).filter(|n| !n.is_empty());
        let res = sqlx::query("UPDATE accounts SET nickname = ? WHERE id = ?").bind(nickname).bind(id).execute(db).await?;
        Ok(res.rows_affected() == 1)
    }

    /// Sets (or clears) the interest rate you entered for an account. Returns false if no such account.
    pub async fn set_apy(db: &sqlx::SqlitePool, id: &str, apy_bps: Option<i64>) -> sqlx::Result<bool> {
        let res = match id.strip_prefix(MANUAL_PREFIX).and_then(|n| n.parse::<i64>().ok()) {
            Some(n) => sqlx::query("UPDATE manual_accounts SET apy_bps = ? WHERE id = ?").bind(apy_bps).bind(n).execute(db).await?,
            None => sqlx::query("UPDATE accounts SET apy_bps = ? WHERE id = ?").bind(apy_bps).bind(id).execute(db).await?,
        };
        Ok(res.rows_affected() == 1)
    }

    pub async fn set_business<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        id: &str,
        business_id: Option<i64>,
    ) -> sqlx::Result<bool> {
        let res = match id.strip_prefix(MANUAL_PREFIX).and_then(|n| n.parse::<i64>().ok()) {
            Some(n) => sqlx::query("UPDATE manual_accounts SET business_id = ? WHERE id = ?").bind(business_id).bind(n).execute(db).await?,
            None => sqlx::query("UPDATE accounts SET business_id = ? WHERE id = ?").bind(business_id).bind(id).execute(db).await?,
        };
        Ok(res.rows_affected() == 1)
    }

}
