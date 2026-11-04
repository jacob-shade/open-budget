use sqlx::{Executor, FromRow, Sqlite};

#[derive(Debug, Clone, FromRow)]
pub struct Item {
    pub id: String,
    pub access_token: String,
    pub institution_id: Option<String>,
    pub institution_name: Option<String>,
    pub sync_cursor: Option<String>,
    pub last_synced_at: Option<String>,
    pub created_at: String,
}

const COLUMNS: &str =
    "id, access_token, institution_id, institution_name, sync_cursor, last_synced_at, created_at";

impl Item {
    /// Insert a newly linked item. Re-linking the same item replaces its access token.
    pub async fn upsert<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        id: &str,
        access_token: &str,
        institution_id: Option<&str>,
        institution_name: Option<&str>,
    ) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO items (id, access_token, institution_id, institution_name)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                access_token = excluded.access_token,
                institution_id = COALESCE(excluded.institution_id, items.institution_id),
                institution_name = COALESCE(excluded.institution_name, items.institution_name),
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .bind(id)
        .bind(access_token)
        .bind(institution_id)
        .bind(institution_name)
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn all<'e, E: Executor<'e, Database = Sqlite>>(db: E) -> sqlx::Result<Vec<Item>> {
        sqlx::query_as(&format!("SELECT {COLUMNS} FROM items ORDER BY institution_name, created_at"))
            .fetch_all(db)
            .await
    }

    pub async fn find<'e, E: Executor<'e, Database = Sqlite>>(db: E, id: &str) -> sqlx::Result<Option<Item>> {
        sqlx::query_as(&format!("SELECT {COLUMNS} FROM items WHERE id = ?"))
            .bind(id)
            .fetch_optional(db)
            .await
    }

    pub async fn mark_synced<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        id: &str,
        cursor: &str,
    ) -> sqlx::Result<()> {
        sqlx::query(
            "UPDATE items SET sync_cursor = ?,
                last_synced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?",
        )
        .bind(cursor)
        .bind(id)
        .execute(db)
        .await?;
        Ok(())
    }

    /// Deletes the item; accounts and transactions cascade.
    pub async fn delete<'e, E: Executor<'e, Database = Sqlite>>(db: E, id: &str) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM items WHERE id = ?").bind(id).execute(db).await?;
        Ok(())
    }

    /// The Plaid environment an access token belongs to ("sandbox", "production", ...), from its
    /// `access-<env>-...` prefix. The prefix isn't secret.
    pub fn environment(&self) -> &str {
        self.access_token.strip_prefix("access-").and_then(|r| r.split('-').next()).unwrap_or("unknown")
    }

    /// Deletes connections that don't belong to `keep_env` locally (their accounts and transactions
    /// go with them by cascade), without contacting Plaid. Returns counts removed.
    pub async fn forget_other_environments(db: &sqlx::SqlitePool, keep_env: &str) -> sqlx::Result<(u64, i64, i64)> {
        let prefix = format!("access-{keep_env}-%");
        let mut tx = db.begin().await?;
        let accounts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM accounts a JOIN items i ON i.id = a.item_id WHERE i.access_token NOT LIKE ?")
            .bind(&prefix)
            .fetch_one(&mut *tx)
            .await?;
        let transactions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN items i ON i.id = a.item_id WHERE i.access_token NOT LIKE ?",
        )
        .bind(&prefix)
        .fetch_one(&mut *tx)
        .await?;
        let items = sqlx::query("DELETE FROM items WHERE access_token NOT LIKE ?").bind(&prefix).execute(&mut *tx).await?.rows_affected();
        tx.commit().await?;
        Ok((items, accounts, transactions))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forgets_only_other_environments_and_their_data() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO businesses (id, name, kind) VALUES (1, 'Cards', 'collectibles')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i1', 'access-sandbox-1'), ('i2', 'access-sandbox-2'), ('p1', 'access-production-9')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type) VALUES ('real', 'p1', 'Real checking', 'depository')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type, business_id) VALUES ('a1', 'i1', 'Checking', 'depository', 1), ('a2', 'i2', 'Card', 'credit', NULL)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, pending) VALUES ('t1', 'a1', -100, '2026-11-01', 'x', 0), ('t2', 'a2', -200, '2026-11-01', 'y', 0)")
            .execute(&db)
            .await
            .unwrap();
        let cats_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories").fetch_one(&db).await.unwrap();

        let all = Item::all(&db).await.unwrap();
        assert_eq!(all.iter().map(|i| i.environment()).collect::<Vec<_>>().iter().filter(|e| **e == "sandbox").count(), 2);
        assert_eq!(Item::forget_other_environments(&db, "production").await.unwrap(), (2, 2, 2));
        let items: Vec<String> = sqlx::query_scalar("SELECT id FROM items").fetch_all(&db).await.unwrap();
        assert_eq!(items, ["p1"], "the production connection is kept");
        let left: i64 = sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM transactions)").fetch_one(&db).await.unwrap();
        assert_eq!(left, 1, "only the production account remains");
        // Businesses and categories are untouched.
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM businesses").fetch_one(&db).await.unwrap(), 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM categories").fetch_one(&db).await.unwrap(), cats_before);
    }
}
