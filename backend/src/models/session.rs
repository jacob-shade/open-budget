use sqlx::{Executor, FromRow, Sqlite};

use crate::services::crypto::{random_token, sha256_b64};

#[derive(Debug, Clone, FromRow)]
pub struct Session {
    pub token_hash: String,
    pub user_id: i64,
    pub mfa_verified: bool,
}

impl Session {
    /// Creates a session and returns the raw token for the cookie. Only its hash is stored.
    pub async fn create<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        user_id: i64,
        mfa_verified: bool,
        now: i64,
        ttl_secs: i64,
    ) -> sqlx::Result<String> {
        let token = random_token(32);
        sqlx::query(
            "INSERT INTO sessions (token_hash, user_id, mfa_verified, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(sha256_b64(&token))
        .bind(user_id)
        .bind(mfa_verified)
        .bind(now)
        .bind(now + ttl_secs)
        .execute(db)
        .await?;
        Ok(token)
    }

    pub async fn find_valid<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        raw_token: &str,
        now: i64,
    ) -> sqlx::Result<Option<Session>> {
        sqlx::query_as(
            "SELECT token_hash, user_id, mfa_verified
             FROM sessions WHERE token_hash = ? AND expires_at > ?",
        )
        .bind(sha256_b64(raw_token))
        .bind(now)
        .fetch_optional(db)
        .await
    }

    /// Increments the failed MFA counter and returns the new count.
    pub async fn record_failed_mfa<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        token_hash: &str,
    ) -> sqlx::Result<i64> {
        sqlx::query_scalar(
            "UPDATE sessions SET failed_mfa_attempts = failed_mfa_attempts + 1
             WHERE token_hash = ? RETURNING failed_mfa_attempts",
        )
        .bind(token_hash)
        .fetch_one(db)
        .await
    }

    pub async fn delete<'e, E: Executor<'e, Database = Sqlite>>(db: E, token_hash: &str) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?").bind(token_hash).execute(db).await?;
        Ok(())
    }

    pub async fn delete_expired<'e, E: Executor<'e, Database = Sqlite>>(db: E, now: i64) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM sessions WHERE expires_at <= ?").bind(now).execute(db).await?;
        Ok(())
    }
}

#[derive(Debug, FromRow)]
pub struct OAuthState {
    pub pkce_verifier: String,
    pub nonce: String,
    pub created_at: i64,
}

impl OAuthState {
    pub async fn insert<'e, E: Executor<'e, Database = Sqlite>>(
        db: E,
        state: &str,
        pkce_verifier: &str,
        nonce: &str,
        now: i64,
    ) -> sqlx::Result<()> {
        sqlx::query("INSERT INTO oauth_states (state, pkce_verifier, nonce, created_at) VALUES (?, ?, ?, ?)")
            .bind(state)
            .bind(pkce_verifier)
            .bind(nonce)
            .bind(now)
            .execute(db)
            .await?;
        Ok(())
    }

    /// Fetches and deletes a state in one step so it can only be used once.
    pub async fn take<'e, E: Executor<'e, Database = Sqlite>>(db: E, state: &str) -> sqlx::Result<Option<OAuthState>> {
        sqlx::query_as("DELETE FROM oauth_states WHERE state = ? RETURNING pkce_verifier, nonce, created_at")
            .bind(state)
            .fetch_optional(db)
            .await
    }

    pub async fn delete_older_than<'e, E: Executor<'e, Database = Sqlite>>(db: E, cutoff: i64) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM oauth_states WHERE created_at < ?").bind(cutoff).execute(db).await?;
        Ok(())
    }
}
