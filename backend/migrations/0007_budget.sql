-- Budget: three buckets (fixed costs, future = saving/investing, fun) that categories belong to,
-- a split of income across them, and planned monthly income per source.

-- Which bucket a category's spending counts toward; NULL = not budgeted (e.g. card payments).
-- Income categories never have a bucket.
ALTER TABLE categories ADD COLUMN bucket TEXT CHECK (bucket IN ('fixed', 'future', 'fun'));

UPDATE categories SET bucket = 'fixed' WHERE plaid_primary IN
    ('RENT_AND_UTILITIES', 'TRANSPORTATION', 'MEDICAL', 'BANK_FEES', 'GENERAL_SERVICES', 'GOVERNMENT_AND_NON_PROFIT', 'HOME_IMPROVEMENT');
UPDATE categories SET bucket = 'fun' WHERE plaid_primary IN
    ('FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'ENTERTAINMENT', 'TRAVEL', 'PERSONAL_CARE', '');
-- Categories you already created that count as spending start in Fun.
UPDATE categories SET bucket = 'fun' WHERE bucket IS NULL AND kind = 'expense';

-- A place for money set aside: move savings/investment transfers here.
INSERT INTO categories (name, emoji, kind, bucket, sort_order)
SELECT 'Savings & investing', '🌱', 'transfer', 'future', 145
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Savings & investing' COLLATE NOCASE);

-- One row: how income is split across the buckets (percent, adds up to 100).
CREATE TABLE budget_settings (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    fixed_pct   INTEGER NOT NULL CHECK (fixed_pct BETWEEN 0 AND 100),
    future_pct  INTEGER NOT NULL CHECK (future_pct BETWEEN 0 AND 100),
    fun_pct     INTEGER NOT NULL CHECK (fun_pct BETWEEN 0 AND 100),
    CHECK (fixed_pct + future_pct + fun_pct = 100)
);
INSERT INTO budget_settings (id, fixed_pct, future_pct, fun_pct) VALUES (1, 50, 20, 30);

-- Planned income per month for each source. `label` matches how income is grouped in Cash flow
-- (who paid you, or a business name with source = 'payout').
CREATE TABLE budget_income_plans (
    source         TEXT NOT NULL CHECK (source IN ('income', 'payout')),
    label          TEXT NOT NULL,
    monthly_cents  INTEGER NOT NULL CHECK (monthly_cents >= 0),
    PRIMARY KEY (source, label)
);
