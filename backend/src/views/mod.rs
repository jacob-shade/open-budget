//! Views: the JSON shapes the API returns. Models are converted into these so that
//! internal fields (e.g. Plaid access tokens) can never leak to the client.

use serde::Serialize;

use crate::models::{account::Account, item::Item, transaction::Transaction};

#[derive(Serialize)]
pub struct ItemView {
    pub id: String,
    pub institution_id: Option<String>,
    pub institution_name: Option<String>,
    pub last_synced_at: Option<String>,
    pub created_at: String,
}

impl From<Item> for ItemView {
    fn from(i: Item) -> Self {
        Self {
            id: i.id,
            institution_id: i.institution_id,
            institution_name: i.institution_name,
            last_synced_at: i.last_synced_at,
            created_at: i.created_at,
        }
    }
}

#[derive(Serialize)]
pub struct AccountView {
    pub id: String,
    pub item_id: String,
    pub institution_name: Option<String>,
    pub name: String,
    pub official_name: Option<String>,
    pub mask: Option<String>,
    #[serde(rename = "type")]
    pub account_type: String,
    pub subtype: Option<String>,
    pub current_balance_cents: Option<i64>,
    pub available_balance_cents: Option<i64>,
    pub credit_limit_cents: Option<i64>,
    pub currency: Option<String>,
    /// Liabilities (credit cards, loans) count against net worth.
    pub is_liability: bool,
    pub updated_at: String,
}

impl From<Account> for AccountView {
    fn from(a: Account) -> Self {
        let is_liability = matches!(a.account_type.as_str(), "credit" | "loan");
        Self {
            id: a.id,
            item_id: a.item_id,
            institution_name: a.institution_name,
            name: a.name,
            official_name: a.official_name,
            mask: a.mask,
            account_type: a.account_type,
            subtype: a.account_subtype,
            current_balance_cents: a.current_balance_cents,
            available_balance_cents: a.available_balance_cents,
            credit_limit_cents: a.credit_limit_cents,
            currency: a.iso_currency_code,
            is_liability,
            updated_at: a.updated_at,
        }
    }
}

#[derive(Serialize)]
pub struct TransactionView {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    /// Negative = money out, positive = money in.
    pub amount_cents: i64,
    pub currency: Option<String>,
    pub date: String,
    pub authorized_date: Option<String>,
    pub name: String,
    pub merchant_name: Option<String>,
    pub category: Option<String>,
    pub category_detailed: Option<String>,
    pub pending: bool,
    pub logo_url: Option<String>,
}

impl From<Transaction> for TransactionView {
    fn from(t: Transaction) -> Self {
        Self {
            id: t.id,
            account_id: t.account_id,
            account_name: t.account_name,
            amount_cents: t.amount_cents,
            currency: t.iso_currency_code,
            date: t.date,
            authorized_date: t.authorized_date,
            name: t.name,
            merchant_name: t.merchant_name,
            category: t.category_primary,
            category_detailed: t.category_detailed,
            pending: t.pending,
            logo_url: t.logo_url,
        }
    }
}

/// Converts a list of models into a list of views.
pub fn render<M, V: From<M>>(models: Vec<M>) -> Vec<V> {
    models.into_iter().map(V::from).collect()
}

#[derive(Serialize)]
pub struct UserView {
    pub email: String,
    pub name: Option<String>,
    pub picture_url: Option<String>,
}

impl From<&crate::models::user::User> for UserView {
    fn from(u: &crate::models::user::User) -> Self {
        Self { email: u.email.clone(), name: u.name.clone(), picture_url: u.picture_url.clone() }
    }
}

/// Where the browser is in the sign-in flow.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthStatus {
    /// No session: show "Sign in with Google".
    Anonymous,
    /// Google sign-in done, no authenticator enrolled yet: show QR setup.
    MfaSetup,
    /// Google sign-in done, authenticator enrolled: ask for a code.
    MfaVerify,
    /// Fully signed in.
    Authenticated,
}

#[derive(Serialize)]
pub struct AuthStatusView {
    pub status: AuthStatus,
    pub user: Option<UserView>,
}

#[derive(Serialize)]
pub struct MfaSetupView {
    /// For manual entry if the QR code can't be scanned.
    pub secret: String,
    pub otpauth_url: String,
    /// SVG markup of the QR code.
    pub qr_svg: String,
}

#[derive(Serialize)]
pub struct RecoveryCodesView {
    pub recovery_codes: Vec<String>,
}
