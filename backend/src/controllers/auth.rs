//! Sign-in: Google OAuth, then TOTP (authenticator app) as a required second factor.
//!
//! Flow:
//!   GET  /api/auth/google/login     -> redirect to Google
//!   GET  /api/auth/google/callback  -> pending session (cookie), redirect to the app
//!   GET  /api/auth/me               -> anonymous | mfa_setup | mfa_verify | authenticated
//!   POST /api/auth/mfa/setup        -> new secret + QR code (first sign-in only)
//!   POST /api/auth/mfa/enable       -> confirm first code, get recovery codes, fully signed in
//!   POST /api/auth/mfa/verify       -> code or recovery code, fully signed in
//!   POST /api/auth/logout

use axum::{
    Json,
    extract::{Query, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{Redirect, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::{
        session::{OAuthState, Session},
        user::{RecoveryCode, User},
    },
    services::{
        crypto::{pkce_challenge, random_token, unix_now},
        totp,
    },
    views::{AuthStatus, AuthStatusView, MfaSetupView, RecoveryCodesView, UserView},
};

const SESSION_COOKIE: &str = "ob_session";
const OAUTH_STATE_COOKIE: &str = "ob_oauth_state";
const OAUTH_COOKIE_PATH: &str = "/api/auth/google";
/// How long to finish the Google round trip.
const OAUTH_STATE_TTL: i64 = 10 * 60;
/// How long between Google sign-in and entering the authenticator code.
const PENDING_SESSION_TTL: i64 = 10 * 60;
const SESSION_TTL: i64 = 7 * 24 * 60 * 60;
const MAX_MFA_ATTEMPTS: i64 = 5;

// ---------- cookies ----------

fn session_cookie(state: &AppState, token: String, ttl: i64) -> Cookie<'static> {
    // Strict: the browser never sends it on requests started by another site, which blocks CSRF.
    // The SPA's own fetch() calls are same-site, so they always carry it.
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Strict)
        .path("/")
        .max_age(time::Duration::seconds(ttl))
        .build()
}

fn clear_session_cookie(jar: CookieJar) -> CookieJar {
    jar.remove(Cookie::build(SESSION_COOKIE).path("/"))
}

/// The current session, if the cookie maps to an unexpired one (pending or verified).
async fn current_session(state: &AppState, jar: &CookieJar) -> AppResult<Option<Session>> {
    match jar.get(SESSION_COOKIE) {
        Some(c) => Ok(Session::find_valid(&state.pool, c.value(), unix_now()).await?),
        None => Ok(None),
    }
}

/// A session that passed Google sign-in but not MFA yet, plus its user.
async fn pending_session(state: &AppState, jar: &CookieJar) -> AppResult<(Session, User)> {
    let session = current_session(state, jar).await?.ok_or(AppError::Unauthorized)?;
    if session.mfa_verified {
        return Err(AppError::BadRequest("already signed in"));
    }
    let user = User::find(&state.pool, session.user_id).await?.ok_or(AppError::Unauthorized)?;
    Ok((session, user))
}

/// Swaps the pending session for a fresh, fully verified one (new token: no session fixation).
async fn complete_sign_in(state: &AppState, jar: CookieJar, pending: &Session) -> AppResult<CookieJar> {
    let mut tx = state.pool.begin().await?;
    Session::delete(&mut *tx, &pending.token_hash).await?;
    let token = Session::create(&mut *tx, pending.user_id, true, unix_now(), SESSION_TTL).await?;
    User::touch_login(&mut *tx, pending.user_id).await?;
    tx.commit().await?;
    Ok(jar.add(session_cookie(state, token, SESSION_TTL)))
}

/// Counts a wrong code; ends the pending session once the limit is hit.
async fn fail_mfa(state: &AppState, jar: CookieJar, session: &Session) -> AppResult<(CookieJar, AppError)> {
    let attempts = Session::record_failed_mfa(&state.pool, &session.token_hash).await?;
    if attempts >= MAX_MFA_ATTEMPTS {
        Session::delete(&state.pool, &session.token_hash).await?;
        tracing::warn!(user_id = session.user_id, "too many failed MFA attempts; session ended");
        return Ok((clear_session_cookie(jar), AppError::TooManyAttempts));
    }
    Ok((jar, AppError::InvalidCode { attempts_left: MAX_MFA_ATTEMPTS - attempts }))
}

// ---------- middleware ----------

/// Guards every data route: requires a session that completed both Google and MFA.
pub async fn require_auth(State(state): State<AppState>, jar: CookieJar, req: Request, next: Next) -> AppResult<Response> {
    match current_session(&state, &jar).await? {
        Some(s) if s.mfa_verified => Ok(next.run(req).await),
        _ => Err(AppError::Unauthorized),
    }
}

// ---------- Google ----------

pub async fn google_login(State(state): State<AppState>, jar: CookieJar) -> AppResult<(CookieJar, Redirect)> {
    let now = unix_now();
    OAuthState::delete_older_than(&state.pool, now - OAUTH_STATE_TTL).await?;

    let oauth_state = random_token(32);
    let verifier = random_token(32);
    let nonce = random_token(16);
    OAuthState::insert(&state.pool, &oauth_state, &verifier, &nonce, now).await?;

    // Ties the callback to this browser (login CSRF). Lax so it survives the redirect back from Google.
    let cookie = Cookie::build((OAUTH_STATE_COOKIE, oauth_state.clone()))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .path(OAUTH_COOKIE_PATH)
        .max_age(time::Duration::seconds(OAUTH_STATE_TTL))
        .build();
    let url = state.google.authorize_url(&oauth_state, &nonce, &pkce_challenge(&verifier));
    Ok((jar.add(cookie), Redirect::to(&url)))
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Google redirects the browser here. Errors redirect to `/?auth_error=<code>` for the UI to show.
pub async fn google_callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(q): Query<CallbackQuery>,
) -> (CookieJar, Redirect) {
    let cookie_state = jar.get(OAUTH_STATE_COOKIE).map(|c| c.value().to_owned());
    let jar = jar.remove(Cookie::build(OAUTH_STATE_COOKIE).path(OAUTH_COOKIE_PATH));
    let home = format!("{}/", state.config.public_url);

    match handle_callback(&state, cookie_state, q).await {
        Ok(token) => (jar.add(session_cookie(&state, token, PENDING_SESSION_TTL)), Redirect::to(&home)),
        Err(code) => {
            tracing::warn!("google sign-in rejected: {code}");
            (jar, Redirect::to(&format!("{home}?auth_error={code}")))
        }
    }
}

async fn handle_callback(state: &AppState, cookie_state: Option<String>, q: CallbackQuery) -> Result<String, &'static str> {
    if q.error.is_some() {
        return Err("google_cancelled");
    }
    let (Some(code), Some(returned_state)) = (q.code, q.state) else {
        return Err("invalid_request");
    };
    if cookie_state.as_deref() != Some(returned_state.as_str()) {
        return Err("state_mismatch");
    }
    let now = unix_now();
    let stored = OAuthState::take(&state.pool, &returned_state)
        .await
        .map_err(|_| "server_error")?
        .filter(|s| s.created_at >= now - OAUTH_STATE_TTL)
        .ok_or("state_expired")?;

    let claims = state
        .google
        .exchange_code(&code, &stored.pkce_verifier, &stored.nonce, now)
        .await
        .map_err(|e| {
            tracing::warn!("google token exchange failed: {e}");
            "google_error"
        })?;
    let email = claims.email.as_deref().unwrap_or_default();
    if !state.config.is_email_allowed(email) {
        tracing::warn!(%email, "sign-in attempt from an account not in ALLOWED_EMAILS");
        return Err("not_allowed");
    }

    let db = |_| "server_error";
    let user_id = User::upsert_from_google(&state.pool, &claims.sub, email, claims.name.as_deref(), claims.picture.as_deref())
        .await
        .map_err(db)?;
    Session::delete_expired(&state.pool, now).await.map_err(db)?;
    Session::create(&state.pool, user_id, false, now, PENDING_SESSION_TTL).await.map_err(db)
}

// ---------- status ----------

pub async fn me(State(state): State<AppState>, jar: CookieJar) -> AppResult<Json<AuthStatusView>> {
    let Some(session) = current_session(&state, &jar).await? else {
        return Ok(Json(AuthStatusView { status: AuthStatus::Anonymous, user: None }));
    };
    let Some(user) = User::find(&state.pool, session.user_id).await? else {
        return Ok(Json(AuthStatusView { status: AuthStatus::Anonymous, user: None }));
    };
    let status = if session.mfa_verified {
        AuthStatus::Authenticated
    } else if user.mfa_enabled() {
        AuthStatus::MfaVerify
    } else {
        AuthStatus::MfaSetup
    };
    Ok(Json(AuthStatusView { status, user: Some(UserView::from(&user)) }))
}

// ---------- MFA ----------

/// First sign-in only: creates a secret for the authenticator app.
pub async fn mfa_setup(State(state): State<AppState>, jar: CookieJar) -> AppResult<Json<MfaSetupView>> {
    let (_, user) = pending_session(&state, &jar).await?;
    if user.mfa_enabled() {
        return Err(AppError::BadRequest("authenticator already set up"));
    }
    let secret = totp::new_secret();
    if !User::set_pending_totp(&state.pool, user.id, &secret).await? {
        return Err(AppError::BadRequest("authenticator already set up"));
    }
    let otpauth_url = totp::otpauth_url(&secret, &user.email);
    let qr_svg = totp::qr_svg(&otpauth_url);
    Ok(Json(MfaSetupView { secret, otpauth_url, qr_svg }))
}

#[derive(Deserialize)]
pub struct CodeRequest {
    code: Option<String>,
    recovery_code: Option<String>,
}

/// Confirms enrollment with the first code from the app and returns one-time recovery codes.
pub async fn mfa_enable(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<CodeRequest>,
) -> Result<(CookieJar, Json<RecoveryCodesView>), (CookieJar, AppError)> {
    let (session, user) = pending_session(&state, &jar).await.map_err(|e| (jar.clone(), e))?;
    let pending = match (&user.totp_secret, &user.totp_pending_secret) {
        (None, Some(p)) => p.clone(),
        _ => return Err((jar, AppError::BadRequest("start setup first"))),
    };
    let code = req.code.unwrap_or_default();
    let Some(step) = totp::verify(&pending, &code, unix_now(), None) else {
        let (jar, err) = fail_mfa(&state, jar.clone(), &session).await.map_err(|e| (jar, e))?;
        return Err((jar, err));
    };

    let (codes, hashes) = totp::new_recovery_codes();
    let result: AppResult<CookieJar> = async {
        let mut tx = state.pool.begin().await?;
        if !User::activate_totp(&mut *tx, user.id, &pending, step).await? {
            return Err(AppError::BadRequest("authenticator already set up"));
        }
        RecoveryCode::replace_all(&mut tx, user.id, &hashes).await?;
        tx.commit().await?;
        tracing::info!(user_id = user.id, "authenticator enrolled");
        complete_sign_in(&state, jar.clone(), &session).await
    }
    .await;
    match result {
        Ok(jar) => Ok((jar, Json(RecoveryCodesView { recovery_codes: codes }))),
        Err(e) => Err((jar, e)),
    }
}

/// Every later sign-in: a code from the app, or a one-time recovery code.
pub async fn mfa_verify(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<CodeRequest>,
) -> Result<(CookieJar, StatusCode), (CookieJar, AppError)> {
    let (session, user) = pending_session(&state, &jar).await.map_err(|e| (jar.clone(), e))?;
    let Some(secret) = &user.totp_secret else {
        return Err((jar, AppError::BadRequest("set up your authenticator first")));
    };

    let ok: AppResult<bool> = async {
        if let Some(code) = req.code.as_deref().filter(|c| !c.trim().is_empty()) {
            match totp::verify(secret, code, unix_now(), user.totp_last_step) {
                Some(step) => Ok(User::consume_totp_step(&state.pool, user.id, step).await?),
                None => Ok(false),
            }
        } else if let Some(code) = req.recovery_code.as_deref().filter(|c| !c.trim().is_empty()) {
            let used = RecoveryCode::consume(&state.pool, user.id, &totp::hash_recovery_code(code)).await?;
            if used {
                let left = RecoveryCode::remaining(&state.pool, user.id).await?;
                tracing::warn!(user_id = user.id, remaining = left, "signed in with a recovery code");
            }
            Ok(used)
        } else {
            Err(AppError::BadRequest("enter a code"))
        }
    }
    .await;

    match ok {
        Ok(true) => complete_sign_in(&state, jar.clone(), &session)
            .await
            .map(|jar| (jar, StatusCode::NO_CONTENT))
            .map_err(|e| (jar, e)),
        Ok(false) => {
            let (jar, err) = fail_mfa(&state, jar.clone(), &session).await.map_err(|e| (jar, e))?;
            Err((jar, err))
        }
        Err(e) => Err((jar, e)),
    }
}

// ---------- sign out ----------

pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> AppResult<(CookieJar, StatusCode)> {
    if let Some(session) = current_session(&state, &jar).await? {
        Session::delete(&state.pool, &session.token_hash).await?;
    }
    Ok((clear_session_cookie(jar), StatusCode::NO_CONTENT))
}
