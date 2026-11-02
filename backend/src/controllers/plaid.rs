use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::item::Item,
    services::sync::{self, SyncSummary},
    views::ItemView,
};

/// Single-user app for now; Plaid just needs a stable id for the end user.
const CLIENT_USER_ID: &str = "local-user";

#[derive(Deserialize, Default)]
pub struct LinkTokenRequest {
    /// Set to open Link in update mode to re-authenticate an existing item.
    pub item_id: Option<String>,
}

#[derive(Serialize)]
pub struct LinkTokenView {
    pub link_token: String,
    pub expiration: String,
}

pub async fn create_link_token(
    State(state): State<AppState>,
    body: Option<Json<LinkTokenRequest>>,
) -> AppResult<Json<LinkTokenView>> {
    let req = body.map(|Json(b)| b).unwrap_or_default();
    let access_token = match req.item_id {
        Some(id) => Some(Item::find(&state.pool, &id).await?.ok_or(AppError::NotFound)?.access_token),
        None => None,
    };
    let res = state
        .plaid
        .create_link_token(CLIENT_USER_ID, access_token.as_deref())
        .await?;
    Ok(Json(LinkTokenView { link_token: res.link_token, expiration: res.expiration }))
}

#[derive(Deserialize)]
pub struct ExchangeRequest {
    pub public_token: String,
    pub institution_id: Option<String>,
    pub institution_name: Option<String>,
}

#[derive(Serialize)]
pub struct ExchangeView {
    pub item: ItemView,
    pub sync: Option<SyncSummary>,
    pub sync_error: Option<String>,
}

pub async fn exchange_public_token(
    State(state): State<AppState>,
    Json(req): Json<ExchangeRequest>,
) -> AppResult<Json<ExchangeView>> {
    let res = state.plaid.exchange_public_token(&req.public_token).await?;
    Item::upsert(
        &state.pool,
        &res.item_id,
        &res.access_token,
        req.institution_id.as_deref(),
        req.institution_name.as_deref(),
    )
    .await?;
    let item = Item::find(&state.pool, &res.item_id).await?.ok_or(AppError::NotFound)?;

    // Pull data right away. The item is saved even if this first sync fails
    // (e.g. transactions not ready yet); the user can re-sync later.
    let (sync, sync_error) = match sync::sync_item(&state.pool, &state.plaid, &item).await {
        Ok(s) => (Some(s), None),
        Err(e) => {
            tracing::warn!(item_id = %item.id, "initial sync failed: {e}");
            (None, Some(e.to_string()))
        }
    };

    // Re-read so the response reflects the sync (last_synced_at).
    let item = Item::find(&state.pool, &item.id).await?.unwrap_or(item);
    Ok(Json(ExchangeView { item: item.into(), sync, sync_error }))
}
