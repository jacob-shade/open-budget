mod config;
mod controllers;
mod db;
mod error;
mod models;
mod services;
mod views;

use std::{net::SocketAddr, sync::Arc};

use sqlx::SqlitePool;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use crate::{
    config::Config,
    services::{google::GoogleClient, plaid::PlaidClient},
};

/// Shared state handed to every controller.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub plaid: Arc<PlaidClient>,
    pub google: Arc<GoogleClient>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "open_budget=debug,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env()?;
    let pool = db::connect(&config.database_url, &config.database_key).await?;
    let plaid = Arc::new(PlaidClient::new(&config));
    let google = Arc::new(GoogleClient::new(&config));
    let config = Arc::new(config);

    let state = AppState { pool, config: config.clone(), plaid, google };
    let mut app = controllers::router(state);
    if let Some(dir) = &config.static_dir {
        // Serve the built React app; unknown paths fall back to index.html for client-side routing.
        let index = format!("{dir}/index.html");
        app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
    }
    let app = app.layer(TraceLayer::new_for_http());

    // Defaults to localhost only: there is no auth layer yet, and this server holds bank access tokens.
    let addr = SocketAddr::from((config.bind_addr, config.port));
    tracing::info!(
        "listening on http://{addr} (public url: {}, plaid env: {}, {} allowed account(s))",
        config.public_url,
        config.plaid_env,
        config.allowed_emails.len()
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
