-- A name you choose for a linked account; Plaid syncs update `name` but never this.
ALTER TABLE accounts ADD COLUMN nickname TEXT;
