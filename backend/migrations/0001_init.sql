-- A Plaid "item" is one login at one institution. It owns one or more accounts.
CREATE TABLE items (
    id                TEXT PRIMARY KEY,           -- Plaid item_id
    access_token      TEXT NOT NULL,              -- secret: never returned by the API
    institution_id    TEXT,
    institution_name  TEXT,
    sync_cursor       TEXT,                       -- /transactions/sync cursor
    last_synced_at    TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE accounts (
    id                      TEXT PRIMARY KEY,     -- Plaid account_id
    item_id                 TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    official_name           TEXT,
    mask                    TEXT,
    account_type            TEXT NOT NULL,        -- depository | credit | loan | investment | other
    account_subtype         TEXT,
    -- Balances are stored in cents, exactly as Plaid reports them
    -- (for credit/loan accounts "current" is the amount owed).
    current_balance_cents   INTEGER,
    available_balance_cents INTEGER,
    credit_limit_cents      INTEGER,
    iso_currency_code       TEXT,
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_accounts_item ON accounts(item_id);

CREATE TABLE transactions (
    id                  TEXT PRIMARY KEY,         -- Plaid transaction_id
    account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Signed cents: negative = money out, positive = money in.
    -- (Plaid's convention is the opposite; we flip it on import.)
    amount_cents        INTEGER NOT NULL,
    iso_currency_code   TEXT,
    date                TEXT NOT NULL,            -- YYYY-MM-DD
    authorized_date     TEXT,
    name                TEXT NOT NULL,
    merchant_name       TEXT,
    category_primary    TEXT,                     -- Plaid personal_finance_category.primary
    category_detailed   TEXT,
    pending             INTEGER NOT NULL DEFAULT 0,
    logo_url            TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date DESC);
CREATE INDEX idx_transactions_date ON transactions(date DESC);
