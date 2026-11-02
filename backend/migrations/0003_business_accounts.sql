-- Accounts the user marks as business: their money counts toward business profit
-- and is left out of personal spending.
ALTER TABLE accounts ADD COLUMN is_business INTEGER NOT NULL DEFAULT 0;
