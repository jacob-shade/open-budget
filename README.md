# open-budget

A self-hosted personal finance app (in the spirit of Monarch Money). It pulls accounts, balances and
transactions from your banks through [Plaid](https://plaid.com).

- **Backend:** Rust ([Axum](https://github.com/tokio-rs/axum)) + SQLite ([SQLx](https://github.com/launchbadge/sqlx))
- **Frontend:** React + TypeScript (Vite)

## Architecture (MVC)

```
backend/src/
  models/        Model: SQLite records + their queries (items, accounts, transactions)
  views/         View: JSON shapes the API returns. Access tokens never leave the server.
  controllers/   Controller: HTTP handlers. Parse request, call models/services, render a view.
  services/      Plaid API client and the transaction sync engine
  migrations/    SQL schema (run automatically on startup)
frontend/src/
  api/           Typed client for the backend
  hooks/         Data loading and actions (useFinanceData)
  components/    UI
```

Amounts are stored as **integer cents**. Transactions are signed: **negative = money out**,
**positive = money in**. This is the opposite of Plaid's convention, so they're flipped on import.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/plaid/link-token` | Create a Plaid Link token (`{ "item_id": ... }` for re-auth/update mode) |
| POST | `/api/plaid/exchange` | Exchange the public token from Link, store the item, run the first sync |
| GET | `/api/items` | Connected institutions |
| POST | `/api/items/{id}/sync` | Sync one institution |
| POST | `/api/sync` | Sync all institutions |
| DELETE | `/api/items/{id}` | Revoke at Plaid and delete local data |
| GET | `/api/accounts` | Accounts and balances |
| GET | `/api/transactions?account_id=&limit=&offset=` | Transactions, newest first |

## Setup

1. Create a Plaid account and get your `client_id` and secret from
   <https://dashboard.plaid.com/developers/keys>.
2. `cp backend/.env.example backend/.env` and fill in `PLAID_CLIENT_ID` and `PLAID_SECRET`.
   Keep `PLAID_ENV=sandbox` to start.

### Run with Docker (any machine)

```sh
docker compose up -d --build
```

Open <http://localhost:3000>. The SQLite database lives in the `budget-data` Docker volume.
Back it up with:

```sh
docker compose cp app:/data/budget.db ./budget-backup.db
```

### Run for development

```sh
# terminal 1
cd backend && cargo run          # API on http://127.0.0.1:3000

# terminal 2
cd frontend && npm install && npm run dev   # UI on http://localhost:5173 (proxies /api)
```

### Try it in Sandbox

Click **Connect a bank**, pick any institution (e.g. "First Platypus Bank"), and log in with
`user_good` / `pass_good`. Sandbox returns fake accounts and transactions.

## Connecting your real banks

Sandbox data is fake. To pull from your actual accounts:

1. In the Plaid dashboard, request **Production** access. Plaid's free tier covers a small number
   of personal connections.
2. Set `PLAID_ENV=production` and use your **production** secret.
3. Many large banks (Chase, Wells Fargo, Capital One, ...) use OAuth. For those, register a
   redirect URI in the Plaid dashboard (under *Developers → API → Allowed redirect URIs*). Set it
   as `PLAID_REDIRECT_URI`, e.g. `https://your-host/oauth`. Plaid requires HTTPS in production.
   The app already handles the `/oauth` return path.

## Security

There is **no login yet**, and the database holds Plaid access tokens that can read your bank data.

- `cargo run` binds to `127.0.0.1` only, and `docker-compose.yml` publishes the port on the host's
  loopback only.
- Don't expose port 3000 to the internet. For remote access, use a VPN such as Tailscale or put an
  authenticating reverse proxy in front of it.
- `backend/.env` and `*.db` files are git-ignored. Never commit them.
