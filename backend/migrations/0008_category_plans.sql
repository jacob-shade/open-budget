-- Planned spending per month for each category (shown per bucket on the Budget page).
CREATE TABLE budget_category_plans (
    category_id    INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    monthly_cents  INTEGER NOT NULL CHECK (monthly_cents >= 0)
);
