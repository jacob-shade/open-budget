-- Businesses, each with its own inventory, sales, trades, expenses and cash on hand.
-- All money is integer cents. `paid_via` says whether money moved as cash on hand or through the
-- bank (bank money already shows in the linked Plaid account balance, so it isn't counted twice).

CREATE TABLE businesses (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    -- collectibles: inventory, sales of items, trades. general: income, expenses, cash only.
    kind        TEXT NOT NULL CHECK (kind IN ('collectibles', 'general')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Bank/card accounts now belong to a specific business instead of a yes/no flag.
-- Their money counts toward that business and is left out of personal spending.
ALTER TABLE accounts ADD COLUMN business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE accounts DROP COLUMN is_business;

CREATE TABLE collectible_sales (
    id              INTEGER PRIMARY KEY,
    business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date            TEXT NOT NULL,                       -- YYYY-MM-DD
    total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),            -- what the buyer paid
    fees_cents      INTEGER NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),   -- platform / payment fees
    shipping_cents  INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0), -- postage you paid
    channel         TEXT,                                -- e.g. eBay, card show, local
    paid_via        TEXT NOT NULL CHECK (paid_via IN ('cash', 'bank')),
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_collectible_sales_business ON collectible_sales(business_id, date);

CREATE TABLE collectible_trades (
    id              INTEGER PRIMARY KEY,
    business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date            TEXT NOT NULL,
    cash_in_cents   INTEGER NOT NULL DEFAULT 0 CHECK (cash_in_cents >= 0),  -- cash you received
    cash_out_cents  INTEGER NOT NULL DEFAULT 0 CHECK (cash_out_cents >= 0), -- cash you added
    paid_via        TEXT NOT NULL CHECK (paid_via IN ('cash', 'bank')),
    -- Cash received beyond the cost of what you gave up; counted as profit.
    gain_cents      INTEGER NOT NULL DEFAULT 0 CHECK (gain_cents >= 0),
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_collectible_trades_business ON collectible_trades(business_id, date);

CREATE TABLE collectible_items (
    id                     INTEGER PRIMARY KEY,
    business_id            INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    category               TEXT,                         -- e.g. Pokémon, Baseball, Comics
    condition              TEXT,                         -- e.g. Raw NM, PSA 10
    acquired_date          TEXT NOT NULL,
    acquired_via           TEXT NOT NULL CHECK (acquired_via IN ('purchase', 'trade', 'other')),
    purchase_paid_via      TEXT CHECK (purchase_paid_via IN ('cash', 'bank')), -- set for purchases
    cost_cents             INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0), -- cost basis
    estimated_value_cents  INTEGER NOT NULL DEFAULT 0 CHECK (estimated_value_cents >= 0),
    status                 TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'traded')),
    sale_id                INTEGER REFERENCES collectible_sales(id),
    sale_price_cents       INTEGER,                      -- this item's share of the sale total
    trade_in_id            INTEGER REFERENCES collectible_trades(id),   -- received in this trade
    trade_out_id           INTEGER REFERENCES collectible_trades(id),   -- given away in this trade
    notes                  TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_collectible_items_business ON collectible_items(business_id, status);
CREATE INDEX idx_collectible_items_sale ON collectible_items(sale_id);

CREATE TABLE business_expenses (
    id            INTEGER PRIMARY KEY,
    business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    category      TEXT NOT NULL CHECK (category IN ('shipping', 'protection', 'table', 'fees', 'travel', 'other')),
    amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
    paid_via      TEXT NOT NULL CHECK (paid_via IN ('cash', 'bank')),
    description   TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_business_expenses_business ON business_expenses(business_id, date);

-- Changes to cash on hand that aren't sales/purchases/trades/expenses:
-- starting cash, depositing cash to the bank (negative), withdrawing cash for a show (positive).
CREATE TABLE cash_adjustments (
    id            INTEGER PRIMARY KEY,
    business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL,
    description   TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_cash_adjustments_business ON cash_adjustments(business_id);
