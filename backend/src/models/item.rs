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
}
