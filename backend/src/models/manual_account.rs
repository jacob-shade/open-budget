//! Accounts entered by hand. They're listed with linked accounts by `Account::all`.

use serde::{Deserialize, Deserializer};
use sqlx::SqlitePool;

use super::{account::MANUAL_PREFIX, business::BusinessError};

pub const TYPES: [&str; 5] = ["depository", "credit", "loan", "investment", "other"];

#[derive(Debug, Deserialize)]
pub struct ManualAccountInput {
    pub name: Option<String>,
    /// depository | credit | loan | investment | other
    pub account_type: Option<String>,
    pub account_subtype: Option<String>,
    pub institution_name: Option<String>,
    /// Current balance; for credit cards and loans, the amount owed.
    pub balance_cents: Option<i64>,
    /// Rate in basis points: APY for savings, APR for loans and cards. Absent = unchanged, null = clear.
    #[serde(default, deserialize_with = "set_or_clear")]
    pub apy_bps: Option<Option<i64>>,
    /// Minimum monthly payment (loans and credit cards only). Absent = unchanged, null = clear.
    #[serde(default, deserialize_with = "set_or_clear")]
    pub min_payment_cents: Option<Option<i64>>,
}

/// Lets a field tell "absent" (None) apart from an explicit null (Some(None)).
fn set_or_clear<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(d).map(Some)
}

fn valid_rate(v: Option<i64>) -> Result<Option<i64>, BusinessError> {
    match v {
        Some(b) if !(0..=10000).contains(&b) => Err(BusinessError::Invalid("rate must be between 0% and 100%")),
        _ => Ok(v),
    }
}

/// Minimum payments only apply to debts; anything else stores none.
fn valid_min_payment(kind: &str, v: Option<i64>) -> Result<Option<i64>, BusinessError> {
    match v {
        Some(c) if c < 0 => Err(BusinessError::Invalid("minimum payment can't be negative")),
        Some(c) if matches!(kind, "loan" | "credit") => Ok(Some(c)),
        _ => Ok(None),
    }
}

fn valid_name(s: &str) -> Result<String, BusinessError> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 100 {
        return Err(BusinessError::Invalid("account names must be 1-100 characters"));
    }
    Ok(t.to_string())
}

fn opt_text(s: &Option<String>) -> Option<String> {
    s.as_deref().map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(100).collect())
}

/// "manual-12" -> 12.
pub fn parse_id(id: &str) -> Option<i64> {
    id.strip_prefix(MANUAL_PREFIX)?.parse().ok()
}

pub async fn create(db: &SqlitePool, input: &ManualAccountInput) -> Result<String, BusinessError> {
    let name = valid_name(input.name.as_deref().unwrap_or_default())?;
    let kind = input.account_type.as_deref().unwrap_or_default();
    if !TYPES.contains(&kind) {
        return Err(BusinessError::Invalid("type must be depository, credit, loan, investment or other"));
    }
    let balance = input.balance_cents.ok_or(BusinessError::Invalid("enter the current balance"))?;
    let rate = valid_rate(input.apy_bps.flatten())?;
    let min_payment = valid_min_payment(kind, input.min_payment_cents.flatten())?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO manual_accounts (name, account_type, account_subtype, institution_name, balance_cents, apy_bps, min_payment_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&name)
    .bind(kind)
    .bind(opt_text(&input.account_subtype))
    .bind(opt_text(&input.institution_name))
    .bind(balance)
    .bind(rate)
    .bind(min_payment)
    .fetch_one(db)
    .await?;
    Ok(format!("{MANUAL_PREFIX}{id}"))
}

/// Updates the fields given; changing the balance also stamps updated_at.
pub async fn update(db: &SqlitePool, id: &str, input: &ManualAccountInput) -> Result<(), BusinessError> {
    let n = parse_id(id).ok_or(BusinessError::NotFound)?;
    type Row = (String, String, Option<String>, Option<String>, i64, Option<i64>, Option<i64>);
    let current: Option<Row> = sqlx::query_as(
        "SELECT name, account_type, account_subtype, institution_name, balance_cents, apy_bps, min_payment_cents FROM manual_accounts WHERE id = ?",
    )
    .bind(n)
    .fetch_optional(db)
    .await?;
    let (name, kind, subtype, institution, balance, rate, min_payment) = current.ok_or(BusinessError::NotFound)?;
    let name = match &input.name {
        Some(v) => valid_name(v)?,
        None => name,
    };
    let kind = input.account_type.clone().unwrap_or(kind);
    if !TYPES.contains(&kind.as_str()) {
        return Err(BusinessError::Invalid("type must be depository, credit, loan, investment or other"));
    }
    let new_balance = input.balance_cents.unwrap_or(balance);
    let rate = valid_rate(input.apy_bps.unwrap_or(rate))?;
    let min_payment = valid_min_payment(&kind, input.min_payment_cents.unwrap_or(min_payment))?;
    sqlx::query(
        "UPDATE manual_accounts SET name = ?, account_type = ?, account_subtype = ?, institution_name = ?, balance_cents = ?,
            apy_bps = ?, min_payment_cents = ?,
            updated_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE updated_at END
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&kind)
    .bind(if input.account_subtype.is_some() { opt_text(&input.account_subtype) } else { subtype })
    .bind(if input.institution_name.is_some() { opt_text(&input.institution_name) } else { institution })
    .bind(new_balance)
    .bind(rate)
    .bind(min_payment)
    .bind(input.balance_cents.is_some())
    .bind(n)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn delete(db: &SqlitePool, id: &str) -> Result<(), BusinessError> {
    let n = parse_id(id).ok_or(BusinessError::NotFound)?;
    let res = sqlx::query("DELETE FROM manual_accounts WHERE id = ?").bind(n).execute(db).await?;
    if res.rows_affected() == 0 {
        return Err(BusinessError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::account::Account;

    #[tokio::test]
    async fn manual_accounts_list_with_linked_ones_and_count_as_debt() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO items (id, access_token, institution_name) VALUES ('i', 'access-production-1', 'Chase')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type, current_balance_cents) VALUES ('a', 'i', 'Checking', 'depository', 500000)")
            .execute(&db)
            .await
            .unwrap();

        let input = |name: &str, kind: &str, bal: i64| ManualAccountInput {
            name: Some(name.into()),
            account_type: Some(kind.into()),
            account_subtype: Some("student".into()),
            institution_name: Some("Sallie Mae".into()),
            balance_cents: Some(bal),
            apy_bps: Some(Some(625)),
            min_payment_cents: Some(Some(21000)),
        };
        let loan = create(&db, &input("Student loan", "loan", 1_200_000)).await.unwrap();
        assert!(loan.starts_with("manual-"));
        assert!(create(&db, &input("", "loan", 1)).await.is_err());
        assert!(create(&db, &input("x", "mortgage", 1)).await.is_err());
        assert!(create(&db, &ManualAccountInput { balance_cents: None, ..input("x", "loan", 0) }).await.is_err());

        let all = Account::all(&db).await.unwrap();
        assert_eq!(all.len(), 2);
        let m = all.iter().find(|a| a.id == loan).unwrap();
        assert!(m.is_manual && !all.iter().find(|a| a.id == "a").unwrap().is_manual);
        assert_eq!((m.account_type.as_str(), m.current_balance_cents, m.institution_name.as_deref()), ("loan", Some(1_200_000), Some("Sallie Mae")));

        // Update the balance; linking to a business works for manual ids too.
        let m = Account::all(&db).await.unwrap().into_iter().find(|a| a.id == loan).unwrap();
        assert_eq!((m.apy_bps, m.min_payment_cents), (Some(625), Some(21000)));
        let none = ManualAccountInput { name: None, account_type: None, account_subtype: None, institution_name: None, balance_cents: None, apy_bps: None, min_payment_cents: None };
        update(&db, &loan, &ManualAccountInput { balance_cents: Some(1_150_000), ..none }).await.unwrap();
        let m = Account::all(&db).await.unwrap().into_iter().find(|a| a.id == loan).unwrap();
        assert_eq!((m.current_balance_cents, m.apy_bps, m.min_payment_cents), (Some(1_150_000), Some(625), Some(21000)), "absent fields stay as they were");
        let none = ManualAccountInput { name: None, account_type: None, account_subtype: None, institution_name: None, balance_cents: None, apy_bps: None, min_payment_cents: None };
        update(&db, &loan, &ManualAccountInput { min_payment_cents: Some(None), ..none }).await.unwrap();
        assert_eq!(Account::all(&db).await.unwrap().into_iter().find(|a| a.id == loan).unwrap().min_payment_cents, None, "null clears");
        let none = ManualAccountInput { name: None, account_type: None, account_subtype: None, institution_name: None, balance_cents: None, apy_bps: None, min_payment_cents: None };
        assert!(update(&db, &loan, &ManualAccountInput { apy_bps: Some(Some(20000)), ..none }).await.is_err());
        // A savings account can't have a minimum payment; a loan's APR isn't interest income.
        let savings = create(&db, &ManualAccountInput { account_type: Some("depository".into()), min_payment_cents: Some(Some(500)), ..input("Savings", "loan", 100) }).await.unwrap();
        assert_eq!(Account::all(&db).await.unwrap().into_iter().find(|a| a.id == savings).unwrap().min_payment_cents, None);
        let b = crate::models::budget::budget(&db, "2026-11-01", "2026-11-30").await.unwrap();
        let interest: Vec<&str> = b.income.iter().filter(|r| r.source == "interest").map(|r| r.label.as_str()).collect();
        assert_eq!(interest, ["Savings interest"], "the loan's 6.25% APR isn't budgeted as income");
        delete(&db, &savings).await.unwrap();
        sqlx::query("INSERT INTO businesses (id, name, kind) VALUES (1, 'Biz', 'general')").execute(&db).await.unwrap();
        assert!(Account::set_business(&db, &loan, Some(1)).await.unwrap());
        assert_eq!(crate::models::business::summary(&db, Some(1), "2026-11-01", "2026-11-30").await.unwrap().bank_cents, -1_150_000, "a business loan counts as debt");

        assert!(matches!(update(&db, "manual-999", &input("x", "loan", 1)).await, Err(BusinessError::NotFound)));
        assert!(matches!(delete(&db, "a").await, Err(BusinessError::NotFound)), "can't delete a linked account this way");
        delete(&db, &loan).await.unwrap();
        assert_eq!(Account::all(&db).await.unwrap().len(), 1);
    }
}
