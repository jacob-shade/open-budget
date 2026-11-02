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
    /// Joined from `items`.
    pub institution_name: Option<String>,
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
        sqlx::query_as(
            "SELECT a.*, i.institution_name
             FROM accounts a JOIN items i ON i.id = a.item_id
             ORDER BY i.institution_name, a.account_type, a.name",
        )
        .fetch_all(db)
        .await
    }
}
