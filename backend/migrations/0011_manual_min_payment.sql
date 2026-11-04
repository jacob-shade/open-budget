-- Minimum monthly payment for manual loans and credit cards (apy_bps holds their APR).
ALTER TABLE manual_accounts ADD COLUMN min_payment_cents INTEGER CHECK (min_payment_cents >= 0);
