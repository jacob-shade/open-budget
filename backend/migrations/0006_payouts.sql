-- Money you pay yourself from a business. Only payouts count as personal income from a business;
-- everything else a business earns stays within the business. A payout lowers the business's cash
-- (when paid in cash) but isn't an expense, so it doesn't change the business's profit.
CREATE TABLE business_payouts (
    id            INTEGER PRIMARY KEY,
    business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    paid_via      TEXT NOT NULL CHECK (paid_via IN ('cash', 'bank')),
    description   TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_business_payouts_business ON business_payouts(business_id, date);
