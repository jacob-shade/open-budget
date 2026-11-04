-- Interest rate (APY) you enter for an account, in basis points (3.50% = 350). Plaid doesn't report
-- savings rates. Interest earned on these accounts is budgeted as income and counted as set aside.
ALTER TABLE accounts ADD COLUMN apy_bps INTEGER CHECK (apy_bps BETWEEN 0 AND 10000);
ALTER TABLE manual_accounts ADD COLUMN apy_bps INTEGER CHECK (apy_bps BETWEEN 0 AND 10000);
