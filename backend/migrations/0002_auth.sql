-- Users sign in with Google; access is limited to ALLOWED_EMAILS.
CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    google_sub           TEXT NOT NULL UNIQUE,     -- Google's stable account id
    email                TEXT NOT NULL,
    name                 TEXT,
    picture_url          TEXT,
    totp_secret          TEXT,                     -- base32; NULL until MFA is enrolled
    totp_pending_secret  TEXT,                     -- during enrollment, before the first code is confirmed
    totp_last_step       INTEGER,                  -- last accepted 30s time step (blocks code replay)
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login_at        TEXT
);

-- One-time MFA recovery codes, stored as SHA-256 hashes.
CREATE TABLE recovery_codes (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    TEXT
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id);

-- Server-side sessions. The cookie holds a random token; only its SHA-256 hash is stored.
-- A session is "pending" (Google OK, MFA not yet passed) until mfa_verified = 1.
CREATE TABLE sessions (
    token_hash           TEXT PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mfa_verified         INTEGER NOT NULL DEFAULT 0,
    failed_mfa_attempts  INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL,         -- unix seconds
    expires_at           INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- In-flight Google OAuth logins (state -> PKCE verifier + nonce).
CREATE TABLE oauth_states (
    state          TEXT PRIMARY KEY,
    pkce_verifier  TEXT NOT NULL,
    nonce          TEXT NOT NULL,
    created_at     INTEGER NOT NULL
);
