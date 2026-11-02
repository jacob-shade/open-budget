//! Minimal typed client for the Plaid endpoints we use.
//! Docs: https://plaid.com/docs/api/

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;

use crate::config::Config;

const PLAID_API_VERSION: &str = "2020-09-14";

pub struct PlaidClient {
    http: reqwest::Client,
    base_url: &'static str,
    client_id: String,
    secret: String,
    redirect_uri: Option<String>,
}

/// Error body Plaid returns on any non-2xx response.
#[derive(Debug, Deserialize)]
pub struct PlaidApiError {
    pub error_type: String,
    pub error_code: String,
    pub error_message: String,
    pub display_message: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum PlaidError {
    #[error("plaid api error {}: {}", .0.error_code, .0.error_message)]
    Api(PlaidApiError),
    #[error("plaid request failed: {0}")]
    Http(#[from] reqwest::Error),
}

impl PlaidError {
    pub fn code(&self) -> Option<&str> {
        match self {
            PlaidError::Api(e) => Some(&e.error_code),
            _ => None,
        }
    }
}

// ---------- response types ----------

#[derive(Debug, Deserialize)]
pub struct LinkTokenResponse {
    pub link_token: String,
    pub expiration: String,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeResponse {
    pub access_token: String,
    pub item_id: String,
}

#[derive(Debug, Deserialize)]
pub struct Balances {
    pub current: Option<f64>,
    pub available: Option<f64>,
    pub limit: Option<f64>,
    pub iso_currency_code: Option<String>,
    pub unofficial_currency_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Account {
    pub account_id: String,
    pub name: String,
    pub official_name: Option<String>,
    pub mask: Option<String>,
    #[serde(rename = "type")]
    pub account_type: String,
    pub subtype: Option<String>,
    pub balances: Balances,
}

#[derive(Debug, Deserialize)]
pub struct AccountsResponse {
    pub accounts: Vec<Account>,
}

#[derive(Debug, Deserialize)]
pub struct PersonalFinanceCategory {
    pub primary: String,
    pub detailed: String,
}

#[derive(Debug, Deserialize)]
pub struct Transaction {
    pub transaction_id: String,
    pub account_id: String,
    /// Plaid convention: positive = money leaving the account.
    pub amount: f64,
    pub iso_currency_code: Option<String>,
    pub unofficial_currency_code: Option<String>,
    pub date: String,
    pub authorized_date: Option<String>,
    pub name: Option<String>,
    pub merchant_name: Option<String>,
    pub pending: bool,
    pub personal_finance_category: Option<PersonalFinanceCategory>,
    pub logo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemovedTransaction {
    pub transaction_id: String,
}

#[derive(Debug, Deserialize)]
pub struct TransactionsSyncResponse {
    pub added: Vec<Transaction>,
    pub modified: Vec<Transaction>,
    pub removed: Vec<RemovedTransaction>,
    pub next_cursor: String,
    pub has_more: bool,
}

// ---------- client ----------

impl PlaidClient {
    pub fn new(config: &Config) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: config.plaid_base_url(),
            client_id: config.plaid_client_id.clone(),
            secret: config.plaid_secret.clone(),
            redirect_uri: config.plaid_redirect_uri.clone(),
        }
    }

    async fn post<B: Serialize, R: DeserializeOwned>(&self, path: &str, body: &B) -> Result<R, PlaidError> {
        let res = self
            .http
            .post(format!("{}{}", self.base_url, path))
            .header("PLAID-CLIENT-ID", &self.client_id)
            .header("PLAID-SECRET", &self.secret)
            .header("Plaid-Version", PLAID_API_VERSION)
            .json(body)
            .send()
            .await?;

        if res.status().is_success() {
            Ok(res.json().await?)
        } else {
            let err: PlaidApiError = res.json().await?;
            tracing::warn!(
                code = %err.error_code,
                request_id = ?err.request_id,
                "plaid {path} failed: {}",
                err.error_message
            );
            Err(PlaidError::Api(err))
        }
    }

    /// Creates a Link token. Pass `access_token` to open Link in "update mode"
    /// for an item that needs the user to re-authenticate.
    pub async fn create_link_token(
        &self,
        client_user_id: &str,
        access_token: Option<&str>,
    ) -> Result<LinkTokenResponse, PlaidError> {
        let mut body = json!({
            "client_name": "Open Budget",
            "language": "en",
            "country_codes": ["US"],
            "user": { "client_user_id": client_user_id },
        });
        match access_token {
            Some(token) => body["access_token"] = json!(token),
            None => {
                body["products"] = json!(["transactions"]);
                body["transactions"] = json!({ "days_requested": 730 });
            }
        }
        if let Some(uri) = &self.redirect_uri {
            body["redirect_uri"] = json!(uri);
        }
        self.post("/link/token/create", &body).await
    }

    pub async fn exchange_public_token(&self, public_token: &str) -> Result<ExchangeResponse, PlaidError> {
        self.post("/item/public_token/exchange", &json!({ "public_token": public_token }))
            .await
    }

    pub async fn get_accounts(&self, access_token: &str) -> Result<AccountsResponse, PlaidError> {
        self.post("/accounts/get", &json!({ "access_token": access_token })).await
    }

    pub async fn transactions_sync(
        &self,
        access_token: &str,
        cursor: Option<&str>,
    ) -> Result<TransactionsSyncResponse, PlaidError> {
        let mut body = json!({ "access_token": access_token, "count": 500 });
        if let Some(c) = cursor {
            body["cursor"] = json!(c);
        }
        self.post("/transactions/sync", &body).await
    }

    pub async fn remove_item(&self, access_token: &str) -> Result<(), PlaidError> {
        let _: serde_json::Value = self.post("/item/remove", &json!({ "access_token": access_token })).await?;
        Ok(())
    }
}
