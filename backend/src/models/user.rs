use sqlx::{Executor, FromRow, Sqlite};

#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: i64,
    pub email: String,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub totp_secret: Option<String>,
    pub totp_pending_secret: Option<String>,
    pub totp_last_step: Option<i64>,
}

const COLUMNS: &str = "id, email, name, picture_url, totp_secret, totp_pending_secret, totp_last_step";

impl User {
    pub fn mfa_enabled(&self) -> bool {
        self.totp_secret.is_some()
    }

    /// Creates or refreshes the user for a Google account; returns the user id.
    pub async fn upsert_from_google<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        google_sub: &str,
        email: &str,
        name: Option<&str>,
        picture_url: Option<&str>,
    ) -> sqlx::Result<i64> {
        sqlx::query_scalar(
            "INSERT INTO users (google_sub, email, name, picture_url) VALUES (?, ?, ?, ?)
             ON CONFLICT(google_sub) DO UPDATE SET
                email = excluded.email, name = excluded.name, picture_url = excluded.picture_url
             RETURNING id",
        )
        .bind(google_sub)
        .bind(email)
        .bind(name)
        .bind(picture_url)
        .fetch_one(db)
        .await
    }

    pub async fn find<'e, E: Executor<'e, Database = Sqlite>>(db: E, id: i64) -> sqlx::Result<Option<User>> {
        sqlx::query_as(&format!("SELECT {COLUMNS} FROM users WHERE id = ?"))
            .bind(id)
            .fetch_optional(db)
            .await
    }

    /// Stores a not-yet-confirmed TOTP secret. Never touches an already enrolled secret.
    pub async fn set_pending_totp<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        id: i64,
        secret: &str,
    ) -> sqlx::Result<bool> {
        let res = sqlx::query("UPDATE users SET totp_pending_secret = ? WHERE id = ? AND totp_secret IS NULL")
            .bind(secret)
            .bind(id)
            .execute(db)
            .await?;
        Ok(res.rows_affected() == 1)
    }

    /// Promotes the pending secret to the active one after the user proved they can generate codes.
    pub async fn activate_totp<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        id: i64,
        pending_secret: &str,
        step: i64,
    ) -> sqlx::Result<bool> {
        let res = sqlx::query(
            "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_last_step = ?
             WHERE id = ? AND totp_secret IS NULL AND totp_pending_secret = ?",
        )
        .bind(step)
        .bind(id)
        .bind(pending_secret)
        .execute(db)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// Records `step` as used. Fails (returns false) if it or a later step was already used,
    /// which stops the same code being accepted twice even under concurrent requests.
    pub async fn consume_totp_step<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        id: i64,
        step: i64,
    ) -> sqlx::Result<bool> {
        let res = sqlx::query(
            "UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)",
        )
        .bind(step)
        .bind(id)
        .bind(step)
        .execute(db)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    pub async fn touch_login<'e, E: Executor<'e, Database = Sqlite>>(db: E, id: i64) -> sqlx::Result<()> {
        sqlx::query("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(id)
            .execute(db)
            .await?;
        Ok(())
    }
}

pub struct RecoveryCode;

impl RecoveryCode {
    /// Replaces all of a user's recovery codes. Call inside a transaction.
    pub async fn replace_all(
        conn: &mut sqlx::SqliteConnection,
        user_id: i64,
        hashes: &[String],
    ) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM recovery_codes WHERE user_id = ?")
            .bind(user_id)
            .execute(&mut *conn)
            .await?;
        for hash in hashes {
            sqlx::query("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)")
                .bind(user_id)
                .bind(hash)
                .execute(&mut *conn)
                .await?;
        }
        Ok(())
    }

    /// Marks a matching unused code as used. Returns false if there was none.
    pub async fn consume<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        user_id: i64,
        code_hash: &str,
    ) -> sqlx::Result<bool> {
        let res = sqlx::query(
            "UPDATE recovery_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = (SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1)",
        )
        .bind(user_id)
        .bind(code_hash)
        .execute(db)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    pub async fn remaining<'e, E: Executor<'e, Database = Sqlite>>(db: E, user_id: i64) -> sqlx::Result<i64> {
        sqlx::query_scalar("SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL")
            .bind(user_id)
            .fetch_one(db)
            .await
    }
}
