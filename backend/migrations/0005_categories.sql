-- User-editable categories. Each Plaid primary category maps to one of these (plaid_primary), so
-- new transactions are categorised automatically; a transaction can override it (category_id).
-- `kind` decides how money in the category counts: expense = spending, income = income,
-- transfer = neither (card/loan payments, moving money between your own accounts).
CREATE TABLE categories (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    emoji          TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
    -- Plaid primary category mapped here. '' = the fallback for uncategorised transactions.
    -- NULL for categories you create.
    plaid_primary  TEXT UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO categories (name, emoji, kind, plaid_primary, sort_order) VALUES
    ('Food & drink',           '🍔', 'expense',  'FOOD_AND_DRINK',            10),
    ('Shopping',               '🛍️', 'expense',  'GENERAL_MERCHANDISE',       20),
    ('Transportation',         '🚗', 'expense',  'TRANSPORTATION',            30),
    ('Travel',                 '✈️', 'expense',  'TRAVEL',                    40),
    ('Entertainment',          '🎬', 'expense',  'ENTERTAINMENT',             50),
    ('Rent & utilities',       '🏠', 'expense',  'RENT_AND_UTILITIES',        60),
    ('Home improvement',       '🔨', 'expense',  'HOME_IMPROVEMENT',          70),
    ('Medical',                '🩺', 'expense',  'MEDICAL',                   80),
    ('Personal care',          '💇', 'expense',  'PERSONAL_CARE',             90),
    ('Services',               '🧰', 'expense',  'GENERAL_SERVICES',         100),
    ('Government & donations', '🏛️', 'expense',  'GOVERNMENT_AND_NON_PROFIT', 110),
    ('Bank fees',              '🏦', 'expense',  'BANK_FEES',                120),
    ('Income',                 '💰', 'income',   'INCOME',                   130),
    ('Card & loan payments',   '💳', 'transfer', 'LOAN_PAYMENTS',            140),
    ('Transfers in',           '📥', 'transfer', 'TRANSFER_IN',              150),
    ('Transfers out',          '📤', 'transfer', 'TRANSFER_OUT',             160),
    ('Uncategorized',          '❔', 'expense',  '',                         999);

-- A category you picked for this transaction; NULL = use the Plaid mapping.
-- Syncing never touches this column, so your choice survives re-syncs.
ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
