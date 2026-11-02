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
        if let Some(account_id) = &filter.account_id {
            q.push(" AND t.account_id = ").push_bind(account_id);
        }
        q.push(" ORDER BY t.date DESC, t.id LIMIT ")
            .push_bind(filter.limit)
            .push(" OFFSET ")
            .push_bind(filter.offset);
        q.build_query_as().fetch_all(db).await
    }
}
