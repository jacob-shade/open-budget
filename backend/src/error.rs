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
    /// No session, or the session hasn't passed MFA.
    #[error("not signed in")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("invalid code")]
    InvalidCode { attempts_left: i64 },
    #[error("too many attempts")]
    TooManyAttempts,
    #[error(transparent)]
    Plaid(#[from] PlaidError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, json!({ "error": "not found" })),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, json!({ "error": "not signed in" })),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, json!({ "error": msg })),
            AppError::InvalidCode { attempts_left } => (
                StatusCode::UNAUTHORIZED,
                json!({ "error": "That code didn't work.", "attempts_left": attempts_left }),
            ),
            AppError::TooManyAttempts => (
                StatusCode::TOO_MANY_REQUESTS,
                json!({ "error": "Too many incorrect codes. Sign in with Google again." }),
            ),
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
