-- Accounts you track by hand (e.g. a loan Plaid can't connect to). They appear alongside linked
-- accounts everywhere; for credit cards and loans the balance is the amount owed.
CREATE TABLE manual_accounts (
    id               INTEGER PRIMARY KEY,
    name             TEXT NOT NULL,
    account_type     TEXT NOT NULL CHECK (account_type IN ('depository', 'credit', 'loan', 'investment', 'other')),
    account_subtype  TEXT,
    institution_name TEXT,
    balance_cents    INTEGER NOT NULL,
    business_id      INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
