//! Categories you can rename, re-emoji and create. See migrations/0005_categories.sql.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use super::business::BusinessError as CategoryError;

pub const KINDS: [&str; 3] = ["expense", "income", "transfer"];

#[derive(Debug, Serialize, FromRow)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub emoji: String,
    pub kind: String,
    /// Plaid category mapped here ('' = uncategorised fallback); None for ones you created.
    pub plaid_primary: Option<String>,
    /// Budget bucket: fixed, future or fun; None = not budgeted. Income categories never have one.
    pub bucket: Option<String>,
    /// Transactions currently in this category.
    pub transaction_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: Option<String>,
    pub emoji: Option<String>,
    pub kind: Option<String>,
    /// "fixed", "future", "fun", or "none" to take it out of the budget. Omitted = unchanged
    /// (new categories: Fun for expenses, none otherwise).
    pub bucket: Option<String>,
}

/// Resolves a requested bucket for a category of `kind`; income categories never have one.
fn resolve_bucket(kind: &str, requested: Option<&str>, current: Option<String>) -> Result<Option<String>, CategoryError> {
    let bucket = match requested {
        None => current,
        Some("none") => None,
        Some(b) if super::budget::BUCKETS.contains(&b) => Some(b.to_string()),
        Some(_) => return Err(CategoryError::Invalid("bucket must be fixed, future, fun or none")),
    };
    if kind == "income" {
        if requested.is_some_and(|b| b != "none") {
            return Err(CategoryError::Invalid("income categories aren't part of a budget bucket"));
        }
        return Ok(None);
    }
    Ok(bucket)
}

fn valid_name(s: &str) -> Result<String, CategoryError> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 60 {
        return Err(CategoryError::Invalid("category names must be 1-60 characters"));
    }
    Ok(t.to_string())
}

/// An emoji (or a short symbol): 1-12 characters, so multi-part emoji like 👨‍👩‍👧 fit.
fn valid_emoji(s: &str) -> Result<String, CategoryError> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 12 || t.chars().any(char::is_whitespace) {
        return Err(CategoryError::Invalid("pick one emoji"));
    }
    Ok(t.to_string())
}

fn valid_kind(s: &str) -> Result<(), CategoryError> {
    if KINDS.contains(&s) { Ok(()) } else { Err(CategoryError::Invalid("type must be expense, income or transfer")) }
}

async fn name_taken(db: &SqlitePool, name: &str, except: Option<i64>) -> sqlx::Result<bool> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE name = ? COLLATE NOCASE AND id IS NOT ?")
        .bind(name)
        .bind(except)
        .fetch_one(db)
        .await?;
    Ok(n > 0)
}

/// All categories with how many transactions are in each, in display order.
pub async fn list(db: &SqlitePool) -> sqlx::Result<Vec<Category>> {
    sqlx::query_as(&format!(
        "SELECT cat.id, cat.name, cat.emoji, cat.kind, cat.plaid_primary, cat.bucket,
                (SELECT COUNT(*) FROM transactions t {} WHERE c.id = cat.id) AS transaction_count
         FROM categories cat ORDER BY cat.sort_order, cat.name COLLATE NOCASE",
        super::transaction::CATEGORY_JOIN
    ))
    .fetch_all(db)
    .await
}

async fn get(db: &SqlitePool, id: i64) -> Result<Category, CategoryError> {
    list(db).await?.into_iter().find(|c| c.id == id).ok_or(CategoryError::NotFound)
}

pub async fn create(db: &SqlitePool, input: &CategoryInput) -> Result<Category, CategoryError> {
    let name = valid_name(input.name.as_deref().unwrap_or_default())?;
    let emoji = valid_emoji(input.emoji.as_deref().unwrap_or_default())?;
    let kind = input.kind.as_deref().unwrap_or("expense");
    valid_kind(kind)?;
    if name_taken(db, &name, None).await? {
        return Err(CategoryError::Invalid("a category with that name already exists"));
    }
    let default_bucket = (kind == "expense").then(|| "fun".to_string());
    let bucket = resolve_bucket(kind, input.bucket.as_deref(), default_bucket)?;
    // New categories go before Uncategorized (999), after the built-in ones.
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO categories (name, emoji, kind, bucket, sort_order)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE sort_order < 999)) RETURNING id",
    )
    .bind(&name)
    .bind(&emoji)
    .bind(kind)
    .bind(&bucket)
    .fetch_one(db)
    .await?;
    get(db, id).await
}

pub async fn update(db: &SqlitePool, id: i64, input: &CategoryInput) -> Result<Category, CategoryError> {
    let current = get(db, id).await?;
    let name = match &input.name {
        Some(n) => valid_name(n)?,
        None => current.name,
    };
    let emoji = match &input.emoji {
        Some(e) => valid_emoji(e)?,
        None => current.emoji,
    };
    let kind = input.kind.clone().unwrap_or(current.kind);
    valid_kind(&kind)?;
    let bucket = resolve_bucket(&kind, input.bucket.as_deref(), current.bucket)?;
    if name_taken(db, &name, Some(id)).await? {
        return Err(CategoryError::Invalid("a category with that name already exists"));
    }
    sqlx::query("UPDATE categories SET name = ?, emoji = ?, kind = ?, bucket = ? WHERE id = ?")
        .bind(&name)
        .bind(&emoji)
        .bind(&kind)
        .bind(&bucket)
        .bind(id)
        .execute(db)
        .await?;
    get(db, id).await
}

/// Deletes a category you created. Transactions you had put in it go back to their automatic category.
/// Categories that Plaid's categories map to can be renamed but not deleted.
pub async fn delete(db: &SqlitePool, id: i64) -> Result<(), CategoryError> {
    let cat = get(db, id).await?;
    if cat.plaid_primary.is_some() {
        return Err(CategoryError::Invalid("built-in categories can be renamed but not deleted"));
    }
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE transactions SET category_id = NULL WHERE category_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM categories WHERE id = ?").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn exists(db: &SqlitePool, id: i64) -> sqlx::Result<bool> {
    Ok(sqlx::query_scalar::<_, i64>("SELECT id FROM categories WHERE id = ?").bind(id).fetch_optional(db).await?.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_edit_delete_and_counts() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let seeded = list(&db).await.unwrap();
        assert_eq!(seeded.len(), 18, "17 from categories + Savings & investing from the budget");
        assert_eq!(seeded.last().unwrap().name, "Uncategorized");

        let input = |name: &str, emoji: &str, kind: Option<&str>| CategoryInput { name: Some(name.into()), emoji: Some(emoji.into()), kind: kind.map(Into::into), bucket: None };
        let cards = create(&db, &input("Trading cards", "🃏", None)).await.unwrap();
        assert_eq!((cards.kind.as_str(), cards.transaction_count, cards.bucket.as_deref()), ("expense", 0, Some("fun")));
        // Buckets: move between them, take out of the budget, never on income.
        let moved = update(&db, cards.id, &CategoryInput { name: None, emoji: None, kind: None, bucket: Some("future".into()) }).await.unwrap();
        assert_eq!(moved.bucket.as_deref(), Some("future"));
        assert!(update(&db, cards.id, &CategoryInput { name: None, emoji: None, kind: None, bucket: Some("someday".into()) }).await.is_err());
        let as_income = update(&db, cards.id, &CategoryInput { name: None, emoji: None, kind: Some("income".into()), bucket: None }).await.unwrap();
        assert_eq!(as_income.bucket, None, "becoming income leaves the budget");
        assert!(update(&db, cards.id, &CategoryInput { name: None, emoji: None, kind: None, bucket: Some("fun".into()) }).await.is_err());
        update(&db, cards.id, &CategoryInput { name: None, emoji: None, kind: Some("expense".into()), bucket: Some("fun".into()) }).await.unwrap();
        assert!(create(&db, &input("trading CARDS", "🎴", None)).await.is_err(), "names are unique ignoring case");
        assert!(create(&db, &input("x", "", None)).await.is_err());
        assert!(create(&db, &input("x", "a b", None)).await.is_err());
        assert!(create(&db, &input("x", "💸", Some("savings"))).await.is_err());
        assert!(create(&db, &input("Family", "👨‍👩‍👧", None)).await.is_ok(), "multi-part emoji fit");
        // Sits before Uncategorized.
        assert_eq!(list(&db).await.unwrap().last().unwrap().name, "Uncategorized");

        // Rename a built-in one and change its emoji; can't delete it.
        let food = seeded.iter().find(|c| c.plaid_primary.as_deref() == Some("FOOD_AND_DRINK")).unwrap();
        let renamed = update(&db, food.id, &CategoryInput { name: Some("Eating out".into()), emoji: Some("🍜".into()), kind: None, bucket: None }).await.unwrap();
        assert_eq!((renamed.name.as_str(), renamed.emoji.as_str(), renamed.kind.as_str()), ("Eating out", "🍜", "expense"));
        assert!(delete(&db, food.id).await.is_err());

        // Counts follow overrides, and deleting a custom category sends its transactions back to automatic.
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type) VALUES ('a', 'i', 'A', 'depository')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, category_primary, pending, category_id) VALUES ('t', 'a', -100, '2026-11-01', 'x', 'FOOD_AND_DRINK', 0, ?)")
            .bind(cards.id)
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(get(&db, cards.id).await.unwrap().transaction_count, 1);
        assert_eq!(get(&db, food.id).await.unwrap().transaction_count, 0);
        delete(&db, cards.id).await.unwrap();
        assert_eq!(get(&db, food.id).await.unwrap().transaction_count, 1);
        let override_left: Option<i64> = sqlx::query_scalar("SELECT category_id FROM transactions WHERE id = 't'").fetch_one(&db).await.unwrap();
        assert_eq!(override_left, None);
    }
}
