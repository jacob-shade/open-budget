//! Controllers: HTTP handlers. They parse requests, call models/services, and render views.

mod accounts;
mod auth;
mod budget;
mod business;
mod categories;
mod items;
mod plaid;
mod transactions;

use axum::{
    Router, middleware,
    routing::{delete, get, patch, post, put},
};

use crate::AppState;

pub fn router(state: AppState) -> Router {
    // Reachable without signing in.
    let public = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/auth/google/login", get(auth::google_login))
        .route("/api/auth/google/callback", get(auth::google_callback))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/mfa/setup", post(auth::mfa_setup))
        .route("/api/auth/mfa/enable", post(auth::mfa_enable))
        .route("/api/auth/mfa/verify", post(auth::mfa_verify))
        .route("/api/auth/logout", post(auth::logout));

    // Everything that touches financial data requires Google sign-in + MFA.
    let protected = Router::new()
        .route("/api/plaid/link-token", post(plaid::create_link_token))
        .route("/api/plaid/exchange", post(plaid::exchange_public_token))
        .route("/api/items", get(items::index))
        .route("/api/items/{id}", delete(items::destroy))
        .route("/api/items/{id}/sync", post(items::sync))
        .route("/api/sync", post(items::sync_all))
        .route("/api/accounts", get(accounts::index))
        .route("/api/accounts/{id}", patch(accounts::update))
        .route("/api/net-worth/history", get(accounts::net_worth_history))
        .route("/api/business-summary", get(business::summary_all))
        .route("/api/businesses", get(business::index).post(business::create))
        .route("/api/businesses/{id}", patch(business::update).delete(business::destroy))
        .route("/api/businesses/{id}/summary", get(business::summary))
        .route("/api/businesses/{id}/items", get(business::items).post(business::create_item))
        .route("/api/businesses/{id}/items/{item}", patch(business::update_item).delete(business::delete_item))
        .route("/api/businesses/{id}/sales", get(business::sales).post(business::create_sale))
        .route("/api/businesses/{id}/sales/{sale}", delete(business::delete_sale))
        .route("/api/businesses/{id}/trades", get(business::trades).post(business::create_trade))
        .route("/api/businesses/{id}/trades/{trade}", delete(business::delete_trade))
        .route("/api/businesses/{id}/expenses", get(business::expenses).post(business::create_expense))
        .route("/api/businesses/{id}/expenses/{row}", delete(business::delete_expense))
        .route("/api/businesses/{id}/cash", get(business::cash).post(business::create_cash))
        .route("/api/businesses/{id}/cash/{row}", delete(business::delete_cash))
        .route("/api/businesses/{id}/payouts", get(business::payouts).post(business::create_payout))
        .route("/api/businesses/{id}/payouts/{row}", delete(business::delete_payout))
        .route("/api/transactions", get(transactions::index))
        .route("/api/transactions/summary", get(transactions::summary))
        .route("/api/transactions/{id}", patch(transactions::update))
        .route("/api/categories", get(categories::index).post(categories::create))
        .route("/api/categories/{id}", patch(categories::update).delete(categories::destroy))
        .route("/api/spending/daily", get(transactions::daily_spending))
        .route("/api/cash-flow", get(transactions::cash_flow))
        .route("/api/budget", get(budget::show))
        .route("/api/budget/percentages", put(budget::set_percentages))
        .route("/api/budget/income-plans", put(budget::set_income_plan))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    public.merge(protected).with_state(state)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{
        AppState,
        config::Config,
        models::{session::Session, user::User},
        services::{crypto::unix_now, google::GoogleClient, plaid::PlaidClient},
    };

    /// The real router over an in-memory database, plus a fully signed-in session cookie.
    async fn app() -> (axum::Router, String, sqlx::SqlitePool) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let config = Config {
            plaid_client_id: "x".into(),
            plaid_secret: "x".into(),
            plaid_env: "sandbox".into(),
            plaid_redirect_uri: None,
            google_client_id: "x".into(),
            google_client_secret: "x".into(),
            allowed_emails: vec!["me@example.com".into()],
            public_url: "http://localhost:3000".into(),
            cookie_secure: false,
            database_url: "sqlite::memory:".into(),
            database_key: crate::db::DatabaseKey::parse(&"ab".repeat(32)).unwrap(),
            port: 0,
            bind_addr: [127, 0, 0, 1].into(),
            static_dir: None,
        };
        let user = User::upsert_from_google(&pool, "sub", "me@example.com", None, None).await.unwrap();
        let token = Session::create(&pool, user, true, unix_now(), 3600).await.unwrap();
        let state = AppState {
            plaid: Arc::new(PlaidClient::new(&config)),
            google: Arc::new(GoogleClient::new(&config)),
            config: Arc::new(config),
            pool: pool.clone(),
        };
        (super::router(state), format!("ob_session={token}"), pool)
    }

    async fn call(app: &axum::Router, cookie: Option<&str>, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(c) = cookie {
            req = req.header(header::COOKIE, c);
        }
        let req = match body {
            Some(b) => req.header(header::CONTENT_TYPE, "application/json").body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn business_routes_work_end_to_end_and_require_sign_in() {
        let (app, cookie, _) = app().await;
        let c = Some(cookie.as_str());

        assert_eq!(call(&app, None, "GET", "/api/businesses", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(call(&app, None, "GET", "/api/cash-flow?start=2026-11-01&end=2026-11-30", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(call(&app, None, "GET", "/api/budget?start=2026-11-01&end=2026-11-30", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(call(&app, None, "PUT", "/api/budget/percentages", Some(json!({"fixed_pct": 50, "future_pct": 20, "fun_pct": 30}))).await.0, StatusCode::UNAUTHORIZED);
        let (s, b) = call(&app, c, "GET", "/api/budget?start=2026-11-01&end=2026-11-30", None).await;
        assert_eq!((s, b["percentages"]["fixed_pct"].as_i64()), (StatusCode::OK, Some(50)));
        assert_eq!(call(&app, c, "PUT", "/api/budget/percentages", Some(json!({"fixed_pct": 50, "future_pct": 20, "fun_pct": 40}))).await.0, StatusCode::BAD_REQUEST);
        assert_eq!(call(&app, c, "PUT", "/api/budget/income-plans", Some(json!({"source": "income", "label": "Acme", "monthly_cents": 500000}))).await.0, StatusCode::NO_CONTENT);
        assert_eq!(call(&app, None, "POST", "/api/businesses", Some(json!({"name": "x", "kind": "general"}))).await.0, StatusCode::UNAUTHORIZED);

        let (s, b) = call(&app, c, "POST", "/api/businesses", Some(json!({"name": "Card Shop", "kind": "collectibles"}))).await;
        assert_eq!(s, StatusCode::OK, "{b}");
        let id = b["id"].as_i64().unwrap();
        assert_eq!(call(&app, c, "POST", "/api/businesses", Some(json!({"name": "", "kind": "general"}))).await.0, StatusCode::BAD_REQUEST);

        let base = format!("/api/businesses/{id}");
        let (s, item) = call(&app, c, "POST", &format!("{base}/items"), Some(json!({
            "name": "Charizard", "acquired_date": "2026-11-01", "acquired_via": "purchase", "purchase_paid_via": "cash",
            "cost_cents": 4000, "estimated_value_cents": 9000
        }))).await;
        assert_eq!(s, StatusCode::OK, "{item}");
        let item_id = item["id"].as_i64().unwrap();
        let (s, edited) = call(&app, c, "PATCH", &format!("{base}/items/{item_id}"), Some(json!({"estimated_value_cents": 10000, "condition": "PSA 9"}))).await;
        assert_eq!((s, edited["estimated_value_cents"].as_i64(), edited["condition"].as_str()), (StatusCode::OK, Some(10000), Some("PSA 9")));

        assert_eq!(call(&app, c, "POST", &format!("{base}/cash"), Some(json!({"date": "2026-11-01", "amount_cents": 20000, "description": "Start"}))).await.0, StatusCode::OK);
        assert_eq!(call(&app, c, "POST", &format!("{base}/expenses"), Some(json!({"date": "2026-11-02", "category": "protection", "amount_cents": 1500, "paid_via": "cash"}))).await.0, StatusCode::OK);
        let (s, sale) = call(&app, c, "POST", &format!("{base}/sales"), Some(json!({"date": "2026-11-03", "item_ids": [item_id], "total_cents": 12000, "fees_cents": 1000, "paid_via": "bank"}))).await;
        assert_eq!(s, StatusCode::OK, "{sale}");
        let (s, trade) = call(&app, c, "POST", &format!("{base}/trades"), Some(json!({
            "date": "2026-11-04", "given_item_ids": [], "received": [{"name": "Pikachu", "estimated_value_cents": 3000}], "cash_out_cents": 2500, "paid_via": "cash"
        }))).await;
        assert_eq!(s, StatusCode::OK, "{trade}");

        let (s, sum) = call(&app, c, "GET", &format!("{base}/summary?start=2026-11-01&end=2026-11-30"), None).await;
        assert_eq!(s, StatusCode::OK);
        // Cash: 200 − 40 (cash buy) − 15 (sleeves) − 25 (trade) = 120; the bank sale doesn't touch cash.
        assert_eq!(sum["cash_on_hand_cents"], 12000);
        assert_eq!(sum["profit_cents"], 12000 - 4000 - 1000 - 1500);
        assert_eq!((sum["inventory_count"].as_i64(), sum["inventory_cost_cents"].as_i64()), (Some(1), Some(2500)));
        let (_, all) = call(&app, c, "GET", "/api/business-summary?start=2026-11-01&end=2026-11-30", None).await;
        assert_eq!(all["profit_cents"], sum["profit_cents"]);

        for list in ["items", "sales", "trades", "expenses", "cash"] {
            let (s, v) = call(&app, c, "GET", &format!("{base}/{list}"), None).await;
            assert_eq!(s, StatusCode::OK, "{list}");
            assert!(v.as_array().is_some_and(|a| !a.is_empty()), "{list} empty");
        }
        let (s, _) = call(&app, c, "POST", &format!("{base}/payouts"), Some(json!({"date": "2026-11-05", "amount_cents": 3000, "paid_via": "cash"}))).await;
        assert_eq!(s, StatusCode::OK);
        let (_, flow) = call(&app, c, "GET", "/api/cash-flow?start=2026-11-01&end=2026-11-30", None).await;
        assert_eq!(flow["income"][0]["source"], "payout");
        assert_eq!(flow["total_income_cents"], 3000);
        assert_eq!(call(&app, c, "GET", "/api/cash-flow?start=bad&end=2026-11-30", None).await.0, StatusCode::BAD_REQUEST);
        let sale_id = sale["id"].as_i64().unwrap();
        assert_eq!(call(&app, c, "DELETE", &format!("{base}/sales/{sale_id}"), None).await.0, StatusCode::NO_CONTENT);
        assert_eq!(call(&app, c, "DELETE", &format!("{base}/sales/{sale_id}"), None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "GET", "/api/businesses/9999/items", None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "PATCH", "/api/accounts/nope", Some(json!({"business_id": id}))).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "DELETE", &base, None).await.0, StatusCode::NO_CONTENT);
        assert_eq!(call(&app, c, "GET", "/api/businesses", None).await.1, json!([]));
    }

    #[tokio::test]
    async fn categories_and_recategorising_transactions() {
        let (app, cookie, pool) = app().await;
        let c = Some(cookie.as_str());
        assert_eq!(call(&app, None, "GET", "/api/categories", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(call(&app, None, "PATCH", "/api/transactions/t1", Some(json!({"category_id": null}))).await.0, StatusCode::UNAUTHORIZED);

        let (s, cats) = call(&app, c, "GET", "/api/categories", None).await;
        assert_eq!(s, StatusCode::OK);
        let food = cats.as_array().unwrap().iter().find(|x| x["plaid_primary"] == "FOOD_AND_DRINK").unwrap()["id"].as_i64().unwrap();

        let (s, new) = call(&app, c, "POST", "/api/categories", Some(json!({"name": "Card show snacks", "emoji": "🌭"}))).await;
        assert_eq!(s, StatusCode::OK, "{new}");
        let snacks = new["id"].as_i64().unwrap();
        let (s, edited) = call(&app, c, "PATCH", &format!("/api/categories/{food}"), Some(json!({"emoji": "🍕", "kind": "expense"}))).await;
        assert_eq!((s, edited["emoji"].as_str()), (StatusCode::OK, Some("🍕")));
        assert_eq!(call(&app, c, "DELETE", &format!("/api/categories/{food}"), None).await.0, StatusCode::BAD_REQUEST);

        // A Plaid food transaction shows the edited emoji, then moves to the custom category and back.
        sqlx::query("INSERT INTO items (id, access_token) VALUES ('i', 'tok')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO accounts (id, item_id, name, account_type) VALUES ('a', 'i', 'Card', 'credit')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transactions (id, account_id, amount_cents, date, name, category_primary, pending) VALUES ('t1', 'a', -850, '2026-11-01', 'HOT DOG STAND', 'FOOD_AND_DRINK', 0)")
            .execute(&pool)
            .await
            .unwrap();
        let first = |v: Value| v.as_array().unwrap()[0].clone();
        let t = first(call(&app, c, "GET", "/api/transactions", None).await.1);
        assert_eq!((t["category_id"].as_i64(), t["category_emoji"].as_str(), t["category_overridden"].as_bool()), (Some(food), Some("🍕"), Some(false)));
        assert_eq!(call(&app, c, "PATCH", "/api/transactions/t1", Some(json!({"category_id": snacks}))).await.0, StatusCode::NO_CONTENT);
        let t = first(call(&app, c, "GET", &format!("/api/transactions?categories={snacks}"), None).await.1);
        assert_eq!((t["category_name"].as_str(), t["category_overridden"].as_bool(), t["plaid_category"].as_str()), (Some("Card show snacks"), Some(true), Some("FOOD_AND_DRINK")));
        assert_eq!(call(&app, c, "GET", &format!("/api/transactions?categories={food}"), None).await.1, json!([]));

        assert_eq!(call(&app, c, "PATCH", "/api/transactions/missing", Some(json!({"category_id": snacks}))).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "PATCH", "/api/transactions/missing", Some(json!({"category_id": 999999}))).await.0, StatusCode::BAD_REQUEST);
        assert_eq!(call(&app, c, "GET", "/api/transactions?categories=abc", None).await.0, StatusCode::BAD_REQUEST);
        // Deleting the custom category puts the transaction back in its automatic one.
        assert_eq!(call(&app, c, "DELETE", &format!("/api/categories/{snacks}"), None).await.0, StatusCode::NO_CONTENT);
        let t = first(call(&app, c, "GET", "/api/transactions", None).await.1);
        assert_eq!((t["category_id"].as_i64(), t["category_overridden"].as_bool()), (Some(food), Some(false)));
    }
}
