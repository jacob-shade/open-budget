//! Businesses and their records: collectible inventory, sales, trades, expenses and cash on hand.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection, SqlitePool};

use crate::services::collectibles::{allocate, trade_basis};

/// A business-rule violation the caller should see (maps to 400).
#[derive(Debug, thiserror::Error)]
pub enum BusinessError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error("not found")]
    NotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

pub type BResult<T> = Result<T, BusinessError>;

#[derive(Debug, Serialize, FromRow)]
pub struct Business {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub category: Option<String>,
    pub condition: Option<String>,
    pub acquired_date: String,
    pub acquired_via: String,
    pub purchase_paid_via: Option<String>,
    pub cost_cents: i64,
    pub estimated_value_cents: i64,
    pub status: String,
    pub sale_id: Option<i64>,
    pub sale_price_cents: Option<i64>,
    pub trade_in_id: Option<i64>,
    pub trade_out_id: Option<i64>,
    pub notes: Option<String>,
}

const ITEM_COLUMNS: &str = "id, name, category, condition, acquired_date, acquired_via, purchase_paid_via, cost_cents,
    estimated_value_cents, status, sale_id, sale_price_cents, trade_in_id, trade_out_id, notes";

#[derive(Debug, Serialize, FromRow)]
pub struct Sale {
    pub id: i64,
    pub date: String,
    pub total_cents: i64,
    pub fees_cents: i64,
    pub shipping_cents: i64,
    pub channel: Option<String>,
    pub paid_via: String,
    pub notes: Option<String>,
    /// Comma-separated names of the items sold (for display).
    pub item_names: Option<String>,
    pub item_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Trade {
    pub id: i64,
    pub date: String,
    pub cash_in_cents: i64,
    pub cash_out_cents: i64,
    pub paid_via: String,
    pub gain_cents: i64,
    pub notes: Option<String>,
    pub given_names: Option<String>,
    pub received_names: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Expense {
    pub id: i64,
    pub date: String,
    pub category: String,
    pub amount_cents: i64,
    pub paid_via: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Payout {
    pub id: i64,
    pub date: String,
    pub amount_cents: i64,
    pub paid_via: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CashAdjustment {
    pub id: i64,
    pub date: String,
    pub amount_cents: i64,
    pub description: Option<String>,
}

// ---------- input ----------

#[derive(Debug, Deserialize)]
pub struct NewItem {
    pub name: String,
    pub category: Option<String>,
    pub condition: Option<String>,
    pub acquired_date: String,
    /// "purchase" or "other" (trade-ins are created by recording a trade).
    pub acquired_via: String,
    pub purchase_paid_via: Option<String>,
    pub cost_cents: i64,
    pub estimated_value_cents: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ItemUpdate {
    pub name: Option<String>,
    pub category: Option<String>,
    pub condition: Option<String>,
    pub estimated_value_cents: Option<i64>,
    /// Only for items you bought (a trade-in's cost comes from the trade).
    pub cost_cents: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewSale {
    pub date: String,
    #[serde(default)]
    pub item_ids: Vec<i64>,
    pub total_cents: i64,
    #[serde(default)]
    pub fees_cents: i64,
    #[serde(default)]
    pub shipping_cents: i64,
    pub channel: Option<String>,
    pub paid_via: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IncomingItem {
    pub name: String,
    pub category: Option<String>,
    pub condition: Option<String>,
    pub estimated_value_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct NewTrade {
    pub date: String,
    pub given_item_ids: Vec<i64>,
    pub received: Vec<IncomingItem>,
    #[serde(default)]
    pub cash_in_cents: i64,
    #[serde(default)]
    pub cash_out_cents: i64,
    pub paid_via: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewExpense {
    pub date: String,
    pub category: String,
    pub amount_cents: i64,
    pub paid_via: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewPayout {
    pub date: String,
    pub amount_cents: i64,
    pub paid_via: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewCashAdjustment {
    pub date: String,
    pub amount_cents: i64,
    pub description: Option<String>,
}

// ---------- validation ----------

pub const KINDS: [&str; 2] = ["collectibles", "general"];
pub const EXPENSE_CATEGORIES: [&str; 6] = ["shipping", "protection", "table", "fees", "travel", "other"];

fn valid_date(s: &str) -> BResult<()> {
    crate::services::net_worth::parse_date(s).map(|_| ()).ok_or(BusinessError::Invalid("dates must be YYYY-MM-DD"))
}
fn valid_paid_via(s: &str) -> BResult<()> {
    if matches!(s, "cash" | "bank") { Ok(()) } else { Err(BusinessError::Invalid("paid_via must be cash or bank")) }
}
fn non_negative(v: i64) -> BResult<()> {
    if v >= 0 { Ok(()) } else { Err(BusinessError::Invalid("amounts can't be negative")) }
}
fn valid_name(s: &str) -> BResult<String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 200 {
        return Err(BusinessError::Invalid("name must be 1-200 characters"));
    }
    Ok(t.to_string())
}
/// Trims optional text; empty becomes None. Caps length.
fn opt_text(s: &Option<String>) -> Option<String> {
    s.as_deref().map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(1000).collect())
}

// ---------- businesses ----------

pub async fn list_businesses(db: &SqlitePool) -> sqlx::Result<Vec<Business>> {
    sqlx::query_as("SELECT id, name, kind, created_at FROM businesses ORDER BY name COLLATE NOCASE").fetch_all(db).await
}

pub async fn get_business(db: &SqlitePool, id: i64) -> BResult<Business> {
    sqlx::query_as("SELECT id, name, kind, created_at FROM businesses WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or(BusinessError::NotFound)
}

pub async fn create_business(db: &SqlitePool, name: &str, kind: &str) -> BResult<Business> {
    let name = valid_name(name)?;
    if !KINDS.contains(&kind) {
        return Err(BusinessError::Invalid("type must be collectibles or general"));
    }
    let id: i64 = sqlx::query_scalar("INSERT INTO businesses (name, kind) VALUES (?, ?) RETURNING id")
        .bind(&name)
        .bind(kind)
        .fetch_one(db)
        .await?;
    get_business(db, id).await
}

pub async fn rename_business(db: &SqlitePool, id: i64, name: &str) -> BResult<Business> {
    let name = valid_name(name)?;
    let res = sqlx::query("UPDATE businesses SET name = ? WHERE id = ?").bind(&name).bind(id).execute(db).await?;
    if res.rows_affected() == 0 {
        return Err(BusinessError::NotFound);
    }
    get_business(db, id).await
}

/// Deletes a business and all of its records. Linked bank accounts become personal again.
pub async fn delete_business(db: &SqlitePool, id: i64) -> BResult<()> {
    let mut tx = db.begin().await?;
    // Items reference sales/trades; delete them first so the cascades never hit a dangling reference.
    for table in ["collectible_items", "collectible_sales", "collectible_trades", "business_expenses", "cash_adjustments", "business_payouts"] {
        sqlx::query(&format!("DELETE FROM {table} WHERE business_id = ?")).bind(id).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE accounts SET business_id = NULL WHERE business_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE manual_accounts SET business_id = NULL WHERE business_id = ?").bind(id).execute(&mut *tx).await?;
    let res = sqlx::query("DELETE FROM businesses WHERE id = ?").bind(id).execute(&mut *tx).await?;
    if res.rows_affected() == 0 {
        return Err(BusinessError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

async fn require_collectibles(db: &SqlitePool, business_id: i64) -> BResult<()> {
    if get_business(db, business_id).await?.kind != "collectibles" {
        return Err(BusinessError::Invalid("inventory and trades are only for collectibles businesses"));
    }
    Ok(())
}

// ---------- items ----------

pub async fn list_items(db: &SqlitePool, business_id: i64) -> sqlx::Result<Vec<Item>> {
    sqlx::query_as(&format!(
        "SELECT {ITEM_COLUMNS} FROM collectible_items WHERE business_id = ?
         ORDER BY status = 'in_stock' DESC, acquired_date DESC, id DESC"
    ))
    .bind(business_id)
    .fetch_all(db)
    .await
}

async fn get_item(conn: &mut SqliteConnection, business_id: i64, id: i64) -> BResult<Item> {
    sqlx::query_as(&format!("SELECT {ITEM_COLUMNS} FROM collectible_items WHERE business_id = ? AND id = ?"))
        .bind(business_id)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(BusinessError::NotFound)
}

pub async fn create_item(db: &SqlitePool, business_id: i64, n: &NewItem) -> BResult<Item> {
    require_collectibles(db, business_id).await?;
    let name = valid_name(&n.name)?;
    valid_date(&n.acquired_date)?;
    non_negative(n.cost_cents)?;
    non_negative(n.estimated_value_cents)?;
    let paid_via = match n.acquired_via.as_str() {
        "purchase" => {
            let p = n.purchase_paid_via.as_deref().ok_or(BusinessError::Invalid("say whether the purchase was cash or bank"))?;
            valid_paid_via(p)?;
            Some(p)
        }
        "other" => None,
        _ => return Err(BusinessError::Invalid("acquired_via must be purchase or other (record trades as trades)")),
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO collectible_items (business_id, name, category, condition, acquired_date, acquired_via,
            purchase_paid_via, cost_cents, estimated_value_cents, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(business_id)
    .bind(&name)
    .bind(opt_text(&n.category))
    .bind(opt_text(&n.condition))
    .bind(&n.acquired_date)
    .bind(&n.acquired_via)
    .bind(paid_via)
    .bind(n.cost_cents)
    .bind(n.estimated_value_cents)
    .bind(opt_text(&n.notes))
    .fetch_one(db)
    .await?;
    let mut conn = db.acquire().await?;
    get_item(&mut conn, business_id, id).await
}

pub async fn update_item(db: &SqlitePool, business_id: i64, id: i64, u: &ItemUpdate) -> BResult<Item> {
    let mut conn = db.acquire().await?;
    let item = get_item(&mut conn, business_id, id).await?;
    if let Some(v) = u.estimated_value_cents {
        non_negative(v)?;
    }
    if let Some(c) = u.cost_cents {
        non_negative(c)?;
        if item.acquired_via == "trade" {
            return Err(BusinessError::Invalid("a trade-in's cost comes from its trade"));
        }
    }
    let name = match &u.name {
        Some(n) => valid_name(n)?,
        None => item.name.clone(),
    };
    sqlx::query(
        "UPDATE collectible_items SET name = ?, category = ?, condition = ?, estimated_value_cents = ?, cost_cents = ?, notes = ?
         WHERE business_id = ? AND id = ?",
    )
    .bind(&name)
    .bind(if u.category.is_some() { opt_text(&u.category) } else { item.category.clone() })
    .bind(if u.condition.is_some() { opt_text(&u.condition) } else { item.condition.clone() })
    .bind(u.estimated_value_cents.unwrap_or(item.estimated_value_cents))
    .bind(u.cost_cents.unwrap_or(item.cost_cents))
    .bind(if u.notes.is_some() { opt_text(&u.notes) } else { item.notes.clone() })
    .bind(business_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    get_item(&mut conn, business_id, id).await
}

/// Only items still in stock that you added directly can be deleted (undo a sale or trade instead).
pub async fn delete_item(db: &SqlitePool, business_id: i64, id: i64) -> BResult<()> {
    let mut conn = db.acquire().await?;
    let item = get_item(&mut conn, business_id, id).await?;
    if item.status != "in_stock" {
        return Err(BusinessError::Invalid("this item was sold or traded; delete that sale or trade first"));
    }
    if item.trade_in_id.is_some() {
        return Err(BusinessError::Invalid("this item came from a trade; delete the trade instead"));
    }
    sqlx::query("DELETE FROM collectible_items WHERE business_id = ? AND id = ?").bind(business_id).bind(id).execute(&mut *conn).await?;
    Ok(())
}

/// Loads in-stock items by id for a sale or trade, rejecting duplicates and anything not in stock.
async fn in_stock_items(conn: &mut SqliteConnection, business_id: i64, ids: &[i64]) -> BResult<Vec<Item>> {
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::with_capacity(ids.len());
    for id in ids {
        if !seen.insert(*id) {
            return Err(BusinessError::Invalid("an item is listed twice"));
        }
        let item = get_item(conn, business_id, *id).await?;
        if item.status != "in_stock" {
            return Err(BusinessError::Invalid("one of the items is no longer in stock"));
        }
        items.push(item);
    }
    Ok(items)
}

// ---------- sales ----------

pub async fn list_sales(db: &SqlitePool, business_id: i64) -> sqlx::Result<Vec<Sale>> {
    sqlx::query_as(
        "SELECT s.id, s.date, s.total_cents, s.fees_cents, s.shipping_cents, s.channel, s.paid_via, s.notes,
                GROUP_CONCAT(i.name, ', ') AS item_names, COUNT(i.id) AS item_count
         FROM collectible_sales s LEFT JOIN collectible_items i ON i.sale_id = s.id
         WHERE s.business_id = ? GROUP BY s.id ORDER BY s.date DESC, s.id DESC",
    )
    .bind(business_id)
    .fetch_all(db)
    .await
}

/// Records a sale. Collectibles sales can include several items; the total is split across them by
/// estimated value. A sale with no items is plain income (any business type).
pub async fn create_sale(db: &SqlitePool, business_id: i64, s: &NewSale) -> BResult<i64> {
    let business = get_business(db, business_id).await?;
    valid_date(&s.date)?;
    valid_paid_via(&s.paid_via)?;
    for v in [s.total_cents, s.fees_cents, s.shipping_cents] {
        non_negative(v)?;
    }
    if !s.item_ids.is_empty() && business.kind != "collectibles" {
        return Err(BusinessError::Invalid("only collectibles businesses sell inventory items"));
    }
    let mut tx = db.begin().await?;
    let items = in_stock_items(&mut tx, business_id, &s.item_ids).await?;
    let sale_id: i64 = sqlx::query_scalar(
        "INSERT INTO collectible_sales (business_id, date, total_cents, fees_cents, shipping_cents, channel, paid_via, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(business_id)
    .bind(&s.date)
    .bind(s.total_cents)
    .bind(s.fees_cents)
    .bind(s.shipping_cents)
    .bind(opt_text(&s.channel))
    .bind(&s.paid_via)
    .bind(opt_text(&s.notes))
    .fetch_one(&mut *tx)
    .await?;
    let shares = allocate(s.total_cents, &items.iter().map(|i| i.estimated_value_cents).collect::<Vec<_>>());
    for (item, share) in items.iter().zip(shares) {
        sqlx::query("UPDATE collectible_items SET status = 'sold', sale_id = ?, sale_price_cents = ? WHERE id = ?")
            .bind(sale_id)
            .bind(share)
            .bind(item.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(sale_id)
}

/// Undoes a sale: its items go back in stock.
pub async fn delete_sale(db: &SqlitePool, business_id: i64, id: i64) -> BResult<()> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE collectible_items SET status = 'in_stock', sale_id = NULL, sale_price_cents = NULL WHERE business_id = ? AND sale_id = ?")
        .bind(business_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query("DELETE FROM collectible_sales WHERE business_id = ? AND id = ?").bind(business_id).bind(id).execute(&mut *tx).await?;
    if res.rows_affected() == 0 {
        return Err(BusinessError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

// ---------- trades ----------

pub async fn list_trades(db: &SqlitePool, business_id: i64) -> sqlx::Result<Vec<Trade>> {
    sqlx::query_as(
        "SELECT t.id, t.date, t.cash_in_cents, t.cash_out_cents, t.paid_via, t.gain_cents, t.notes,
                (SELECT GROUP_CONCAT(name, ', ') FROM collectible_items WHERE trade_out_id = t.id) AS given_names,
                (SELECT GROUP_CONCAT(name, ', ') FROM collectible_items WHERE trade_in_id = t.id) AS received_names
         FROM collectible_trades t WHERE t.business_id = ? ORDER BY t.date DESC, t.id DESC",
    )
    .bind(business_id)
    .fetch_all(db)
    .await
}

pub async fn create_trade(db: &SqlitePool, business_id: i64, t: &NewTrade) -> BResult<i64> {
    require_collectibles(db, business_id).await?;
    valid_date(&t.date)?;
    valid_paid_via(&t.paid_via)?;
    non_negative(t.cash_in_cents)?;
    non_negative(t.cash_out_cents)?;
    if t.given_item_ids.is_empty() && t.received.is_empty() {
        return Err(BusinessError::Invalid("a trade needs items given or received"));
    }
    let mut received = Vec::with_capacity(t.received.len());
    for r in &t.received {
        non_negative(r.estimated_value_cents)?;
        received.push((valid_name(&r.name)?, r));
    }

    let mut tx = db.begin().await?;
    let given = in_stock_items(&mut tx, business_id, &t.given_item_ids).await?;
    let basis = trade_basis(given.iter().map(|i| i.cost_cents).sum(), t.cash_out_cents, t.cash_in_cents);
    let trade_id: i64 = sqlx::query_scalar(
        "INSERT INTO collectible_trades (business_id, date, cash_in_cents, cash_out_cents, paid_via, gain_cents, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(business_id)
    .bind(&t.date)
    .bind(t.cash_in_cents)
    .bind(t.cash_out_cents)
    .bind(&t.paid_via)
    .bind(basis.gain)
    .bind(opt_text(&t.notes))
    .fetch_one(&mut *tx)
    .await?;
    for item in &given {
        sqlx::query("UPDATE collectible_items SET status = 'traded', trade_out_id = ? WHERE id = ?")
            .bind(trade_id)
            .bind(item.id)
            .execute(&mut *tx)
            .await?;
    }
    let costs = allocate(basis.incoming_cost, &received.iter().map(|(_, r)| r.estimated_value_cents).collect::<Vec<_>>());
    for ((name, r), cost) in received.iter().zip(costs) {
        sqlx::query(
            "INSERT INTO collectible_items (business_id, name, category, condition, acquired_date, acquired_via,
                cost_cents, estimated_value_cents, trade_in_id)
             VALUES (?, ?, ?, ?, ?, 'trade', ?, ?, ?)",
        )
        .bind(business_id)
        .bind(name)
        .bind(opt_text(&r.category))
        .bind(opt_text(&r.condition))
        .bind(&t.date)
        .bind(cost)
        .bind(r.estimated_value_cents)
        .bind(trade_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(trade_id)
}

/// Undoes a trade: items you gave come back, items you received are removed. Refused if a received
/// item has since been sold or traded (undo that first).
pub async fn delete_trade(db: &SqlitePool, business_id: i64, id: i64) -> BResult<()> {
    let mut tx = db.begin().await?;
    let moved: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collectible_items WHERE business_id = ? AND trade_in_id = ? AND status != 'in_stock'")
        .bind(business_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if moved > 0 {
        return Err(BusinessError::Invalid("an item from this trade was sold or traded since; undo that first"));
    }
    sqlx::query("DELETE FROM collectible_items WHERE business_id = ? AND trade_in_id = ?").bind(business_id).bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE collectible_items SET status = 'in_stock', trade_out_id = NULL WHERE business_id = ? AND trade_out_id = ?")
        .bind(business_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query("DELETE FROM collectible_trades WHERE business_id = ? AND id = ?").bind(business_id).bind(id).execute(&mut *tx).await?;
    if res.rows_affected() == 0 {
        return Err(BusinessError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

// ---------- expenses & cash ----------

pub async fn list_expenses(db: &SqlitePool, business_id: i64) -> sqlx::Result<Vec<Expense>> {
    sqlx::query_as(
        "SELECT id, date, category, amount_cents, paid_via, description FROM business_expenses
         WHERE business_id = ? ORDER BY date DESC, id DESC",
    )
    .bind(business_id)
    .fetch_all(db)
    .await
}

pub async fn create_expense(db: &SqlitePool, business_id: i64, e: &NewExpense) -> BResult<i64> {
    get_business(db, business_id).await?;
    valid_date(&e.date)?;
    valid_paid_via(&e.paid_via)?;
    non_negative(e.amount_cents)?;
    if !EXPENSE_CATEGORIES.contains(&e.category.as_str()) {
        return Err(BusinessError::Invalid("unknown expense category"));
    }
    Ok(sqlx::query_scalar(
        "INSERT INTO business_expenses (business_id, date, category, amount_cents, paid_via, description)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(business_id)
    .bind(&e.date)
    .bind(&e.category)
    .bind(e.amount_cents)
    .bind(&e.paid_via)
    .bind(opt_text(&e.description))
    .fetch_one(db)
    .await?)
}

pub async fn list_cash(db: &SqlitePool, business_id: i64) -> sqlx::Result<Vec<CashAdjustment>> {
    sqlx::query_as("SELECT id, date, amount_cents, description FROM cash_adjustments WHERE business_id = ? ORDER BY date DESC, id DESC")
        .bind(business_id)
        .fetch_all(db)
        .await
}

pub async fn create_cash(db: &SqlitePool, business_id: i64, c: &NewCashAdjustment) -> BResult<i64> {
    get_business(db, business_id).await?;
    valid_date(&c.date)?;
    if c.amount_cents == 0 {
        return Err(BusinessError::Invalid("amount can't be zero"));
    }
    Ok(sqlx::query_scalar("INSERT INTO cash_adjustments (business_id, date, amount_cents, description) VALUES (?, ?, ?, ?) RETURNING id")
        .bind(business_id)
        .bind(&c.date)
        .bind(c.amount_cents)
        .bind(opt_text(&c.description))
        .fetch_one(db)
        .await?)
}

pub async fn list_payouts(db: &SqlitePool, business_id: i64) -> sqlx::Result<Vec<Payout>> {
    sqlx::query_as("SELECT id, date, amount_cents, paid_via, description FROM business_payouts WHERE business_id = ? ORDER BY date DESC, id DESC")
        .bind(business_id)
        .fetch_all(db)
        .await
}

/// Records money you paid yourself; it counts as your personal income in Cash flow.
pub async fn create_payout(db: &SqlitePool, business_id: i64, p: &NewPayout) -> BResult<i64> {
    get_business(db, business_id).await?;
    valid_date(&p.date)?;
    valid_paid_via(&p.paid_via)?;
    if p.amount_cents <= 0 {
        return Err(BusinessError::Invalid("a payout must be more than zero"));
    }
    Ok(sqlx::query_scalar("INSERT INTO business_payouts (business_id, date, amount_cents, paid_via, description) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .bind(business_id)
        .bind(&p.date)
        .bind(p.amount_cents)
        .bind(&p.paid_via)
        .bind(opt_text(&p.description))
        .fetch_one(db)
        .await?)
}

/// Deletes an expense, cash adjustment or payout row belonging to the business.
pub async fn delete_row(db: &SqlitePool, table: &'static str, business_id: i64, id: i64) -> BResult<()> {
    debug_assert!(matches!(table, "business_expenses" | "cash_adjustments" | "business_payouts"));
    let res = sqlx::query(&format!("DELETE FROM {table} WHERE business_id = ? AND id = ?")).bind(business_id).bind(id).execute(db).await?;
    if res.rows_affected() == 0 {
        return Err(BusinessError::NotFound);
    }
    Ok(())
}

// ---------- summary ----------

#[derive(Debug, Default, Serialize)]
pub struct Summary {
    /// Cash on hand now (all time).
    pub cash_on_hand_cents: i64,
    /// Linked bank/card accounts now (debt negative).
    pub bank_cents: i64,
    pub inventory_count: i64,
    pub inventory_value_cents: i64,
    pub inventory_cost_cents: i64,
    // Period [start, end]:
    pub sales_cents: i64,
    pub trade_gain_cents: i64,
    /// Cost basis of the items sold in the period.
    pub cost_of_sold_cents: i64,
    /// Fees and shipping on sales in the period.
    pub selling_costs_cents: i64,
    pub expenses_cents: i64,
    pub expenses_by_category: Vec<CategoryTotal>,
    pub profit_cents: i64,
    /// Paid to you in the period (not an expense; doesn't change profit).
    pub payouts_cents: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CategoryTotal {
    pub category: String,
    pub amount_cents: i64,
}

/// Assets now and profit for [start, end], for one business or (None) all businesses.
pub async fn summary(db: &SqlitePool, business_id: Option<i64>, start: &str, end: &str) -> BResult<Summary> {
    valid_date(start)?;
    valid_date(end)?;
    // `?1 IS NULL OR business_id = ?1` scopes every query to one business or all of them.
    let scalar = |sql: &'static str| {
        let q = sqlx::query_scalar::<_, i64>(sql).bind(business_id);
        q
    };
    let cash_adj = scalar("SELECT COALESCE(SUM(amount_cents), 0) FROM cash_adjustments WHERE (?1 IS NULL OR business_id = ?1)").fetch_one(db).await?;
    let cash_sales = scalar("SELECT COALESCE(SUM(total_cents - fees_cents - shipping_cents), 0) FROM collectible_sales WHERE paid_via = 'cash' AND (?1 IS NULL OR business_id = ?1)").fetch_one(db).await?;
    let cash_buys = scalar("SELECT COALESCE(SUM(cost_cents), 0) FROM collectible_items WHERE acquired_via = 'purchase' AND purchase_paid_via = 'cash' AND (?1 IS NULL OR business_id = ?1)").fetch_one(db).await?;
    let cash_trades = scalar("SELECT COALESCE(SUM(cash_in_cents - cash_out_cents), 0) FROM collectible_trades WHERE paid_via = 'cash' AND (?1 IS NULL OR business_id = ?1)").fetch_one(db).await?;
    let cash_expenses = scalar("SELECT COALESCE(SUM(amount_cents), 0) FROM business_expenses WHERE paid_via = 'cash' AND (?1 IS NULL OR business_id = ?1)").fetch_one(db).await?;
    let cash_payouts = scalar("SELECT COALESCE(SUM(amount_cents), 0) FROM business_payouts WHERE paid_via = 'cash' AND (?1 IS NULL OR business_id = ?1)").fetch_one(db).await?;
    let bank = scalar(
        "SELECT COALESCE(SUM(CASE WHEN account_type IN ('credit', 'loan') THEN -COALESCE(bal, 0) ELSE COALESCE(bal, 0) END), 0) FROM (
            SELECT account_type, current_balance_cents AS bal, business_id FROM accounts
            UNION ALL SELECT account_type, balance_cents, business_id FROM manual_accounts
         ) WHERE business_id IS NOT NULL AND (?1 IS NULL OR business_id = ?1)",
    )
    .fetch_one(db)
    .await?;
    let (inventory_count, inventory_value_cents, inventory_cost_cents): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(estimated_value_cents), 0), COALESCE(SUM(cost_cents), 0)
         FROM collectible_items WHERE status = 'in_stock' AND (?1 IS NULL OR business_id = ?1)",
    )
    .bind(business_id)
    .fetch_one(db)
    .await?;

    let period = |sql: &'static str| sqlx::query_scalar::<_, i64>(sql).bind(business_id).bind(start).bind(end);
    let (sales_cents, selling_costs_cents): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total_cents), 0), COALESCE(SUM(fees_cents + shipping_cents), 0) FROM collectible_sales
         WHERE (?1 IS NULL OR business_id = ?1) AND date >= ?2 AND date <= ?3",
    )
    .bind(business_id)
    .bind(start)
    .bind(end)
    .fetch_one(db)
    .await?;
    let cost_of_sold_cents = period(
        "SELECT COALESCE(SUM(i.cost_cents), 0) FROM collectible_items i JOIN collectible_sales s ON s.id = i.sale_id
         WHERE (?1 IS NULL OR s.business_id = ?1) AND s.date >= ?2 AND s.date <= ?3",
    )
    .fetch_one(db)
    .await?;
    let trade_gain_cents = period("SELECT COALESCE(SUM(gain_cents), 0) FROM collectible_trades WHERE (?1 IS NULL OR business_id = ?1) AND date >= ?2 AND date <= ?3")
        .fetch_one(db)
        .await?;
    let expenses_by_category: Vec<CategoryTotal> = sqlx::query_as(
        "SELECT category, SUM(amount_cents) AS amount_cents FROM business_expenses
         WHERE (?1 IS NULL OR business_id = ?1) AND date >= ?2 AND date <= ?3 GROUP BY category ORDER BY amount_cents DESC",
    )
    .bind(business_id)
    .bind(start)
    .bind(end)
    .fetch_all(db)
    .await?;
    let expenses_cents = expenses_by_category.iter().map(|c| c.amount_cents).sum();
    let payouts_cents = period("SELECT COALESCE(SUM(amount_cents), 0) FROM business_payouts WHERE (?1 IS NULL OR business_id = ?1) AND date >= ?2 AND date <= ?3")
        .fetch_one(db)
        .await?;

    Ok(Summary {
        cash_on_hand_cents: cash_adj + cash_sales - cash_buys + cash_trades - cash_expenses - cash_payouts,
        bank_cents: bank,
        inventory_count,
        inventory_value_cents,
        inventory_cost_cents,
        sales_cents,
        trade_gain_cents,
        cost_of_sold_cents,
        selling_costs_cents,
        expenses_cents,
        profit_cents: sales_cents + trade_gain_cents - cost_of_sold_cents - selling_costs_cents - expenses_cents,
        expenses_by_category,
        payouts_cents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn item(name: &str, cost: i64, value: i64, via: &str) -> NewItem {
        NewItem {
            name: name.into(),
            category: Some("Pokémon".into()),
            condition: None,
            acquired_date: "2026-10-01".into(),
            acquired_via: "purchase".into(),
            purchase_paid_via: Some(via.into()),
            cost_cents: cost,
            estimated_value_cents: value,
            notes: None,
        }
    }

    #[tokio::test]
    async fn collectibles_flow_tracks_cash_inventory_and_profit() {
        let db = pool().await;
        let b = create_business(&db, "  Card Shop ", "collectibles").await.unwrap();
        assert_eq!(b.name, "Card Shop");
        assert!(create_business(&db, "x", "lemonade").await.is_err());

        create_cash(&db, b.id, &NewCashAdjustment { date: "2026-10-01".into(), amount_cents: 50000, description: Some("Starting cash".into()) }).await.unwrap();
        let a = create_item(&db, b.id, &item("Charizard", 5000, 15000, "cash")).await.unwrap();
        let c = create_item(&db, b.id, &item("Pikachu", 2000, 5000, "cash")).await.unwrap();
        let d = create_item(&db, b.id, &item("Mewtwo", 10000, 12000, "bank")).await.unwrap();

        // Sell Charizard + Pikachu together for $180 cash, $0 fees, $5 shipping.
        let sale = create_sale(&db, b.id, &NewSale {
            date: "2026-10-10".into(), item_ids: vec![a.id, c.id], total_cents: 18000, fees_cents: 0, shipping_cents: 500,
            channel: Some("Card show".into()), paid_via: "cash".into(), notes: None,
        }).await.unwrap();
        let items = list_items(&db, b.id).await.unwrap();
        let price = |id: i64| items.iter().find(|i| i.id == id).unwrap().sale_price_cents;
        assert_eq!((price(a.id), price(c.id)), (Some(13500), Some(4500)), "split 3:1 by estimated value");
        // Can't sell the same item twice.
        assert!(create_sale(&db, b.id, &NewSale {
            date: "2026-10-11".into(), item_ids: vec![a.id], total_cents: 1, fees_cents: 0, shipping_cents: 0, channel: None, paid_via: "cash".into(), notes: None,
        }).await.is_err());

        // Trade Mewtwo ($100 cost) + $20 cash for two cards; received $30 cash back... net basis $90.
        let trade = create_trade(&db, b.id, &NewTrade {
            date: "2026-10-12".into(), given_item_ids: vec![d.id],
            received: vec![
                IncomingItem { name: "Lugia".into(), category: None, condition: Some("PSA 9".into()), estimated_value_cents: 9000 },
                IncomingItem { name: "Ho-Oh".into(), category: None, condition: None, estimated_value_cents: 3000 },
            ],
            cash_in_cents: 3000, cash_out_cents: 2000, paid_via: "cash".into(), notes: None,
        }).await.unwrap();
        let items = list_items(&db, b.id).await.unwrap();
        let lugia = items.iter().find(|i| i.name == "Lugia").unwrap();
        let hooh = items.iter().find(|i| i.name == "Ho-Oh").unwrap();
        assert_eq!((lugia.cost_cents, hooh.cost_cents), (6750, 2250), "basis $90 split 3:1");
        assert_eq!(items.iter().find(|i| i.id == d.id).unwrap().status, "traded");

        create_expense(&db, b.id, &NewExpense { date: "2026-10-05".into(), category: "table".into(), amount_cents: 7500, paid_via: "cash".into(), description: Some("Show table".into()) }).await.unwrap();
        create_expense(&db, b.id, &NewExpense { date: "2026-10-06".into(), category: "protection".into(), amount_cents: 1500, paid_via: "bank".into(), description: Some("Toploaders".into()) }).await.unwrap();
        assert!(create_expense(&db, b.id, &NewExpense { date: "2026-10-06".into(), category: "snacks".into(), amount_cents: 1, paid_via: "bank".into(), description: None }).await.is_err());

        let s = summary(&db, Some(b.id), "2026-10-01", "2026-10-31").await.unwrap();
        // Cash: 500 start − 50 − 20 (cash buys) + (180 − 5) sale + (30 − 20) trade − 75 table = 540.00
        assert_eq!(s.cash_on_hand_cents, 54000);
        assert_eq!((s.inventory_count, s.inventory_value_cents, s.inventory_cost_cents), (2, 12000, 9000));
        assert_eq!(s.sales_cents, 18000);
        assert_eq!(s.cost_of_sold_cents, 7000);
        assert_eq!(s.selling_costs_cents, 500);
        assert_eq!(s.expenses_cents, 9000);
        assert_eq!(s.trade_gain_cents, 0);
        assert_eq!(s.profit_cents, 18000 - 7000 - 500 - 9000);
        // Outside the period: no profit, same assets.
        let nov = summary(&db, Some(b.id), "2026-11-01", "2026-11-30").await.unwrap();
        assert_eq!((nov.profit_cents, nov.cash_on_hand_cents), (0, 54000));

        // A trade-in that was since sold blocks undoing the trade.
        create_sale(&db, b.id, &NewSale {
            date: "2026-10-20".into(), item_ids: vec![lugia.id], total_cents: 9500, fees_cents: 1200, shipping_cents: 0,
            channel: Some("eBay".into()), paid_via: "bank".into(), notes: None,
        }).await.unwrap();
        assert!(delete_trade(&db, b.id, trade).await.is_err());

        // Undoing the first sale puts both items back in stock.
        delete_sale(&db, b.id, sale).await.unwrap();
        let items = list_items(&db, b.id).await.unwrap();
        assert!(items.iter().filter(|i| i.id == a.id || i.id == c.id).all(|i| i.status == "in_stock" && i.sale_price_cents.is_none()));

        // Sold/traded items can't be deleted directly; trade-ins can't either.
        assert!(delete_item(&db, b.id, d.id).await.is_err());
        assert!(delete_item(&db, b.id, hooh.id).await.is_err());
        delete_item(&db, b.id, c.id).await.unwrap();

        // Another business can't see or touch these records.
        let other = create_business(&db, "Other", "general").await.unwrap();
        assert!(list_items(&db, other.id).await.unwrap().is_empty());
        assert!(matches!(delete_item(&db, other.id, a.id).await, Err(BusinessError::NotFound)));
        assert!(create_item(&db, other.id, &item("x", 1, 1, "cash")).await.is_err(), "general businesses have no inventory");

        // Deleting a business removes its records and unlinks its accounts.
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type, current_balance_cents, business_id) VALUES ('acct', 'i', 'Biz', 'depository', 12345, ?)")
            .bind(b.id).execute(&db).await.unwrap();
        assert_eq!(summary(&db, Some(b.id), "2026-10-01", "2026-10-31").await.unwrap().bank_cents, 12345);
        delete_business(&db, b.id).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM collectible_items) + (SELECT COUNT(*) FROM collectible_sales) + (SELECT COUNT(*) FROM collectible_trades) + (SELECT COUNT(*) FROM business_expenses) + (SELECT COUNT(*) FROM cash_adjustments)")
            .fetch_one(&db).await.unwrap();
        assert_eq!(left, 0);
        let linked: Option<i64> = sqlx::query_scalar("SELECT business_id FROM accounts WHERE id = 'acct'").fetch_one(&db).await.unwrap();
        assert_eq!(linked, None);
    }

    #[tokio::test]
    async fn trade_with_extra_cash_records_a_gain() {
        let db = pool().await;
        let b = create_business(&db, "Cards", "collectibles").await.unwrap();
        let x = create_item(&db, b.id, &item("Old card", 5000, 6000, "bank")).await.unwrap();
        create_trade(&db, b.id, &NewTrade {
            date: "2026-10-02".into(), given_item_ids: vec![x.id],
            received: vec![IncomingItem { name: "New card".into(), category: None, condition: None, estimated_value_cents: 2000 }],
            cash_in_cents: 8000, cash_out_cents: 0, paid_via: "cash".into(), notes: None,
        }).await.unwrap();
        let s = summary(&db, Some(b.id), "2026-10-01", "2026-10-31").await.unwrap();
        assert_eq!((s.trade_gain_cents, s.profit_cents, s.inventory_cost_cents, s.cash_on_hand_cents), (3000, 3000, 0, 8000));

        // Paying yourself $50 in cash: cash drops, profit doesn't; a bank payout doesn't touch cash.
        create_payout(&db, b.id, &NewPayout { date: "2026-10-03".into(), amount_cents: 5000, paid_via: "cash".into(), description: None }).await.unwrap();
        create_payout(&db, b.id, &NewPayout { date: "2026-10-04".into(), amount_cents: 2000, paid_via: "bank".into(), description: None }).await.unwrap();
        assert!(create_payout(&db, b.id, &NewPayout { date: "2026-10-04".into(), amount_cents: 0, paid_via: "bank".into(), description: None }).await.is_err());
        let s = summary(&db, Some(b.id), "2026-10-01", "2026-10-31").await.unwrap();
        assert_eq!((s.profit_cents, s.cash_on_hand_cents, s.payouts_cents), (3000, 3000, 7000));
    }
}
