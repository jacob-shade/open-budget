use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Serialize;

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::item::Item,
    services::sync::{self, SyncSummary},
    views::{ItemView, render},
};

pub async fn index(State(state): State<AppState>) -> AppResult<Json<Vec<ItemView>>> {
    Ok(Json(render(Item::all(&state.pool).await?)))
}

pub async fn sync(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<SyncSummary>> {
    let item = Item::find(&state.pool, &id).await?.ok_or(AppError::NotFound)?;
    Ok(Json(sync::sync_item(&state.pool, &state.plaid, &item).await?))
}

#[derive(Serialize)]
pub struct SyncAllView {
    pub synced: Vec<SyncSummary>,
    pub failed: Vec<SyncFailure>,
}

#[derive(Serialize)]
pub struct SyncFailure {
    pub item_id: String,
    pub institution_name: Option<String>,
    pub error: String,
    /// e.g. ITEM_LOGIN_REQUIRED means the user must re-link via update mode.
    pub plaid_error_code: Option<String>,
}

pub async fn sync_all(State(state): State<AppState>) -> AppResult<Json<SyncAllView>> {
    let mut view = SyncAllView { synced: vec![], failed: vec![] };
    for item in Item::all(&state.pool).await? {
        match sync::sync_item(&state.pool, &state.plaid, &item).await {
            Ok(summary) => view.synced.push(summary),
            Err(e) => view.failed.push(SyncFailure {
                item_id: item.id.clone(),
                institution_name: item.institution_name.clone(),
                plaid_error_code: match &e {
                    AppError::Plaid(p) => p.code().map(str::to_owned),
                    _ => None,
                },
                error: e.to_string(),
            }),
        }
    }
    Ok(Json(view))
}

/// Revokes the access token at Plaid, then deletes the item and its data locally.
pub async fn destroy(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<StatusCode> {
    let item = Item::find(&state.pool, &id).await?.ok_or(AppError::NotFound)?;
    if let Err(e) = state.plaid.remove_item(&item.access_token).await {
        // Still delete locally if Plaid already considers the item gone.
        if e.code() != Some("ITEM_NOT_FOUND") {
            return Err(e.into());
        }
    }
    Item::delete(&state.pool, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}
