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

    // Maintenance commands (run with the app stopped), e.g. `open-budget forget-plaid-items --yes`.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(cmd) = args.first() {
        return maintenance(&pool, &config.plaid_env, cmd, &args[1..]).await;
    }

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

    // Defaults to localhost only (BIND_ADDR); every data route also requires Google sign-in + MFA.
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

/// One-off maintenance commands; the server doesn't start.
async fn maintenance(pool: &sqlx::SqlitePool, env: &str, cmd: &str, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    match cmd {
        // After switching PLAID_ENV (e.g. sandbox -> production), connections from the old environment
        // can't be revoked with the new keys. This deletes only those, locally, with their accounts and
        // transactions; connections from the current environment are kept.
        "forget-plaid-items" => {
            let items = models::item::Item::all(pool).await?;
            let stale: Vec<_> = items.iter().filter(|i| i.environment() != env).collect();
            for i in &items {
                let fate = if i.environment() == env { "keep" } else { "delete" };
                println!("  [{fate}] {} ({}, {})", i.institution_name.as_deref().unwrap_or("Unknown institution"), i.environment(), i.id);
            }
            if stale.is_empty() {
                println!("Nothing to delete: every connection belongs to the current Plaid environment ({env}).");
                return Ok(());
            }
            if !args.iter().any(|a| a == "--yes") {
                println!("Would delete {} connection(s) not from {env}, with their accounts and transactions. Re-run with --yes to delete.", stale.len());
                return Ok(());
            }
            let (items, accounts, transactions) = models::item::Item::forget_other_environments(pool, env).await?;
            println!("Deleted {items} connection(s), {accounts} account(s) and {transactions} transaction(s). Plaid was not contacted.");
            Ok(())
        }
        other => Err(format!("unknown command '{other}' (available: forget-plaid-items [--yes])").into()),
    }
}
