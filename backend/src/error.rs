use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::services::plaid::PlaidError;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error(transparent)]
    Plaid(#[from] PlaidError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, json!({ "error": "not found" })),
            AppError::Plaid(PlaidError::Api(e)) => (
                StatusCode::BAD_GATEWAY,
                json!({
                    "error": e.display_message.clone().unwrap_or_else(|| e.error_message.clone()),
                    "plaid_error_code": e.error_code,
                    "plaid_error_type": e.error_type,
                }),
            ),
            AppError::Plaid(e) => {
                tracing::error!("plaid transport error: {e}");
                (StatusCode::BAD_GATEWAY, json!({ "error": "could not reach Plaid" }))
            }
            AppError::Db(e) => {
                tracing::error!("database error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "database error" }))
            }
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
