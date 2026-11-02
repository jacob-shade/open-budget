//! Pulls accounts + transactions from Plaid for an item and writes them to SQLite.

use serde::Serialize;
use sqlx::SqlitePool;

use crate::{
    error::AppResult,
    models::{account::Account, item::Item, transaction::Transaction},
    services::plaid::{self, PlaidClient, PlaidError},
};

#[derive(Debug, Default, Serialize)]
pub struct SyncSummary {
    pub item_id: String,
    pub accounts: usize,
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
}

const MAX_SYNC_ATTEMPTS: usize = 3;

pub async fn sync_item(pool: &SqlitePool, plaid: &PlaidClient, item: &Item) -> AppResult<SyncSummary> {
    // 1. Accounts + balances.
    let accounts = plaid.get_accounts(&item.access_token).await?.accounts;

    // 2. Page through /transactions/sync from the saved cursor. If the data changes
    //    mid-pagination Plaid tells us to restart from the original cursor.
    let mut attempt = 0;
    let (added, modified, removed, next_cursor) = loop {
        attempt += 1;
        match fetch_all_pages(plaid, item).await {
            Ok(result) => break result,
            Err(e)
                if e.code() == Some("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
                    && attempt < MAX_SYNC_ATTEMPTS =>
            {
                tracing::info!(item_id = %item.id, "sync mutated during pagination, restarting");
            }
            Err(e) => return Err(e.into()),
        }
    };

    // 3. Apply everything in one DB transaction so the cursor never gets ahead of the data.
    let mut tx = pool.begin().await?;
    for account in &accounts {
        Account::upsert_from_plaid(&mut *tx, &item.id, account).await?;
    }
    for t in added.iter().chain(modified.iter()) {
        Transaction::upsert_from_plaid(&mut *tx, t).await?;
    }
    for id in &removed {
        Transaction::delete(&mut *tx, id).await?;
    }
    Item::mark_synced(&mut *tx, &item.id, &next_cursor).await?;
    tx.commit().await?;

    let summary = SyncSummary {
        item_id: item.id.clone(),
        accounts: accounts.len(),
        added: added.len(),
        modified: modified.len(),
        removed: removed.len(),
    };
    tracing::info!(?summary, "synced item");
    Ok(summary)
}

type Pages = (Vec<plaid::Transaction>, Vec<plaid::Transaction>, Vec<String>, String);

async fn fetch_all_pages(plaid: &PlaidClient, item: &Item) -> Result<Pages, PlaidError> {
    let mut cursor = item.sync_cursor.clone();
    let (mut added, mut modified, mut removed) = (Vec::new(), Vec::new(), Vec::new());
    loop {
        let page = plaid.transactions_sync(&item.access_token, cursor.as_deref()).await?;
        added.extend(page.added);
        modified.extend(page.modified);
        removed.extend(page.removed.into_iter().map(|r| r.transaction_id));
        cursor = Some(page.next_cursor);
        if !page.has_more {
            return Ok((added, modified, removed, cursor.unwrap_or_default()));
        }
    }
}
