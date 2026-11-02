//! SQLite database, encrypted at rest with SQLCipher (AES-256, whole file incl. WAL and indexes).

use std::{
    fmt,
    path::{Path, PathBuf},
    str::FromStr,
};

use sqlx::{
    ConnectOptions, Connection, Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions},
};

/// 256-bit raw SQLCipher key (64 hex chars). Raw keys skip SQLCipher's PBKDF2 step,
/// which is unnecessary for a random key. Debug output is redacted.
#[derive(Clone)]
pub struct DatabaseKey(String);

impl DatabaseKey {
    pub fn parse(hex: &str) -> Result<Self, String> {
        let hex = hex.trim();
        if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("DATABASE_KEY must be 64 hex characters (generate one with: openssl rand -hex 32)".into());
        }
        Ok(Self(hex.to_ascii_lowercase()))
    }

    /// Value for `PRAGMA key = ...` / `ATTACH ... KEY ...`.
    fn sql_literal(&self) -> String {
        format!("\"x'{}'\"", self.0)
    }
}

impl fmt::Debug for DatabaseKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DatabaseKey(<redacted>)")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

pub async fn connect(database_url: &str, key: &DatabaseKey) -> Result<SqlitePool, DbError> {
    let base = SqliteConnectOptions::from_str(database_url)?;
    let path = base.get_filename().to_path_buf();

    if is_plaintext_sqlite(&path)? {
        encrypt_existing(&path, key).await?;
    }

    // sqlx always issues `PRAGMA key` first on each new connection, before any other statement.
    let options = base
        .pragma("key", key.sql_literal())
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| DbError::Other(format!("could not open the encrypted database (wrong DATABASE_KEY?): {e}")))?;

    // Refuse to run if this binary was somehow built against plain SQLite: data would be unencrypted.
    let cipher_version: Option<String> = sqlx::query_scalar("PRAGMA cipher_version").fetch_optional(&pool).await?;
    match cipher_version {
        Some(v) if !v.is_empty() => tracing::info!("database encrypted with SQLCipher {v}"),
        _ => return Err(DbError::Other("SQLCipher is not available; refusing to store data unencrypted".into())),
    }

    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

/// Unencrypted SQLite files start with this header; SQLCipher files look like random bytes.
fn is_plaintext_sqlite(path: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    let mut header = [0u8; 16];
    match std::fs::File::open(path) {
        Ok(mut f) => Ok(f.read_exact(&mut header).is_ok() && &header == b"SQLite format 3\0"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// One-time upgrade of a database created before encryption was added: copies everything into
/// a new SQLCipher file, verifies every table's row count, then replaces the plaintext file.
async fn encrypt_existing(path: &Path, key: &DatabaseKey) -> Result<(), DbError> {
    tracing::warn!("found unencrypted database at {}; encrypting it with SQLCipher", path.display());
    let tmp = sidecar(path, ".encrypting");
    for p in [&tmp, &sidecar(&tmp, "-wal"), &sidecar(&tmp, "-shm")] {
        let _ = std::fs::remove_file(p);
    }
    let tmp_sql = tmp.to_string_lossy().replace('\'', "''");

    // Opening without a key reads the plaintext file. create_if_missing grants SQLITE_OPEN_CREATE,
    // which ATTACH inherits and needs to create the new encrypted file.
    let mut plain = SqliteConnectOptions::new().filename(path).create_if_missing(true).connect().await?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&mut plain).await?;
    let expected = table_counts(&mut plain).await?;
    sqlx::query(&format!("ATTACH DATABASE '{tmp_sql}' AS encrypted KEY {}", key.sql_literal()))
        .execute(&mut plain)
        .await?;
    sqlx::query("SELECT sqlcipher_export('encrypted')").fetch_all(&mut plain).await?;
    sqlx::query("DETACH DATABASE encrypted").execute(&mut plain).await?;
    plain.close().await?;

    // Verify the encrypted copy before touching the original.
    let mut enc = SqliteConnectOptions::new()
        .filename(&tmp)
        .pragma("key", key.sql_literal())
        .connect()
        .await?;
    let actual = table_counts(&mut enc).await?;
    enc.close().await?;
    if actual != expected {
        let _ = std::fs::remove_file(&tmp);
        return Err(DbError::Other(format!(
            "encrypted copy doesn't match the original ({expected:?} vs {actual:?}); original left untouched"
        )));
    }
    if is_plaintext_sqlite(&tmp)? {
        let _ = std::fs::remove_file(&tmp);
        return Err(DbError::Other("encrypted copy is not encrypted; original left untouched".into()));
    }

    for p in [sidecar(path, "-wal"), sidecar(path, "-shm")] {
        let _ = std::fs::remove_file(p);
    }
    std::fs::rename(&tmp, path)?;
    tracing::warn!(
        "database encrypted ({} tables). Back up DATABASE_KEY: without it the data cannot be recovered",
        expected.len()
    );
    Ok(())
}

async fn table_counts(conn: &mut SqliteConnection) -> Result<Vec<(String, i64)>, DbError> {
    let tables: Vec<String> =
        sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .fetch_all(&mut *conn)
            .await?
            .iter()
            .map(|r| r.get(0))
            .collect();
    let mut counts = Vec::with_capacity(tables.len());
    for t in tables {
        let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", t.replace('"', "\"\"")))
            .fetch_one(&mut *conn)
            .await?;
        counts.push((t, n));
    }
    Ok(counts)
}

/// Plaid reports money as floating-point dollars; we store integer cents.
pub fn to_cents(amount: f64) -> i64 {
    (amount * 100.0).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation_and_redaction() {
        assert!(DatabaseKey::parse("abc").is_err());
        assert!(DatabaseKey::parse(&"g".repeat(64)).is_err());
        let k = DatabaseKey::parse(&"AB".repeat(32)).unwrap();
        assert_eq!(k.sql_literal(), format!("\"x'{}'\"", "ab".repeat(32)));
        assert_eq!(format!("{k:?}"), "DatabaseKey(<redacted>)");
    }
}
