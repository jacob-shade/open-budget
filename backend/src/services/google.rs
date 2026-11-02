//! Google Sign-In via OpenID Connect (authorization code flow + PKCE).
//! https://developers.google.com/identity/openid-connect/openid-connect

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;

use crate::config::Config;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const ISSUERS: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];

pub struct GoogleClient {
    http: reqwest::Client,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

#[derive(Debug, thiserror::Error)]
pub enum GoogleError {
    #[error("google request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("google token endpoint returned {status}: {body}")]
    Token { status: u16, body: String },
    #[error("invalid id_token: {0}")]
    InvalidIdToken(&'static str),
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: String,
}

#[derive(Debug, Deserialize)]
pub struct IdTokenClaims {
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub exp: i64,
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub nonce: Option<String>,
}

impl GoogleClient {
    pub fn new(config: &Config) -> Self {
        Self {
            http: reqwest::Client::new(),
            client_id: config.google_client_id.clone(),
            client_secret: config.google_client_secret.clone(),
            redirect_uri: format!("{}/api/auth/google/callback", config.public_url),
        }
    }

    pub fn authorize_url(&self, state: &str, nonce: &str, code_challenge: &str) -> String {
        reqwest::Url::parse_with_params(
            AUTH_URL,
            &[
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("response_type", "code"),
                ("scope", "openid email profile"),
                ("state", state),
                ("nonce", nonce),
                ("code_challenge", code_challenge),
                ("code_challenge_method", "S256"),
                ("prompt", "select_account"),
            ],
        )
        .expect("static auth URL is valid")
        .to_string()
    }

    /// Exchanges the authorization code and returns the validated ID token claims.
    pub async fn exchange_code(
        &self,
        code: &str,
        pkce_verifier: &str,
        expected_nonce: &str,
        now: i64,
    ) -> Result<IdTokenClaims, GoogleError> {
        let res = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("code", code),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("redirect_uri", &self.redirect_uri),
                ("grant_type", "authorization_code"),
                ("code_verifier", pkce_verifier),
            ])
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(GoogleError::Token { status: res.status().as_u16(), body: res.text().await.unwrap_or_default() });
        }
        let token: TokenResponse = res.json().await?;
        let claims = decode_claims(&token.id_token)?;
        validate_claims(&claims, &self.client_id, expected_nonce, now)?;
        Ok(claims)
    }
}

/// Reads the ID token payload. The signature isn't checked: the token came straight from
/// Google's token endpoint over TLS in exchange for our client secret, which OIDC Core §3.1.3.7
/// accepts in place of signature validation. The claims are still validated below.
fn decode_claims(id_token: &str) -> Result<IdTokenClaims, GoogleError> {
    let payload = id_token.split('.').nth(1).ok_or(GoogleError::InvalidIdToken("malformed"))?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| GoogleError::InvalidIdToken("bad base64"))?;
    serde_json::from_slice(&bytes).map_err(|_| GoogleError::InvalidIdToken("bad claims json"))
}

pub fn validate_claims(c: &IdTokenClaims, client_id: &str, nonce: &str, now: i64) -> Result<(), GoogleError> {
    if !ISSUERS.contains(&c.iss.as_str()) {
        return Err(GoogleError::InvalidIdToken("wrong issuer"));
    }
    if c.aud != client_id {
        return Err(GoogleError::InvalidIdToken("wrong audience"));
    }
    if c.exp < now {
        return Err(GoogleError::InvalidIdToken("expired"));
    }
    if c.nonce.as_deref() != Some(nonce) {
        return Err(GoogleError::InvalidIdToken("nonce mismatch"));
    }
    if c.email.is_none() || !c.email_verified {
        return Err(GoogleError::InvalidIdToken("email not verified"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims() -> IdTokenClaims {
        IdTokenClaims {
            iss: "https://accounts.google.com".into(),
            aud: "client-123".into(),
            sub: "1001".into(),
            exp: 2_000,
            email: Some("me@gmail.com".into()),
            email_verified: true,
            name: None,
            picture: None,
            nonce: Some("n1".into()),
        }
    }

    #[test]
    fn accepts_valid_claims() {
        assert!(validate_claims(&claims(), "client-123", "n1", 1_000).is_ok());
    }

    #[test]
    fn rejects_bad_claims() {
        let check = |f: fn(&mut IdTokenClaims)| {
            let mut c = claims();
            f(&mut c);
            validate_claims(&c, "client-123", "n1", 1_000).is_err()
        };
        assert!(check(|c| c.iss = "https://evil.example".into()));
        assert!(check(|c| c.aud = "other-client".into()));
        assert!(check(|c| c.exp = 999));
        assert!(check(|c| c.nonce = Some("n2".into())));
        assert!(check(|c| c.nonce = None));
        assert!(check(|c| c.email_verified = false));
        assert!(check(|c| c.email = None));
    }

    #[test]
    fn decodes_payload() {
        let payload = URL_SAFE_NO_PAD.encode(
            br#"{"iss":"accounts.google.com","aud":"a","sub":"s","exp":1,"email":"e@x.com","email_verified":true}"#,
        );
        let c = decode_claims(&format!("hdr.{payload}.sig")).unwrap();
        assert_eq!(c.sub, "s");
        assert!(c.email_verified);
        assert!(decode_claims("not-a-jwt").is_err());
    }
}
