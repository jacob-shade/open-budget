# open-budget

A self-hosted personal finance app. It pulls accounts, balances and transactions from your banks through [Plaid](https://plaid.com).

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

All routes except `/api/health` and `/api/auth/*` require a signed-in session (Google + authenticator code).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/google/login` | Start Google sign-in (browser redirect) |
| GET | `/api/auth/me` | Sign-in status: `anonymous`, `mfa_setup`, `mfa_verify`, `authenticated` |
| POST | `/api/auth/mfa/setup` · `/enable` · `/verify` | Authenticator enrollment and code check |
| POST | `/api/auth/logout` | Sign out |
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
2. Create a Google OAuth client (see [Google sign-in](#google-sign-in) below).
3. `cp backend/.env.example backend/.env` and fill in the Plaid and Google values and
   `ALLOWED_EMAILS`. Keep `PLAID_ENV=sandbox` to start.

### Google sign-in

1. In <https://console.cloud.google.com/>, create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email.
   Leave it in *Testing* and add your Google account under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Under **Authorized redirect URIs** add:
   - `http://localhost:3000/api/auth/google/callback` (Docker / `cargo run`)
   - `http://localhost:5173/api/auth/google/callback` (Vite dev server, optional)
4. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and your Google email(s)
   in `ALLOWED_EMAILS`.
5. Set `PUBLIC_URL` to the URL you open in the browser (`http://localhost:3000`, or
   `http://localhost:5173` when using the Vite dev server). Use `localhost`, not `127.0.0.1`:
   cookies and the redirect URI must match it exactly.

The first time you sign in, the app shows a QR code. Scan it with **Google Authenticator**, enter
the 6-digit code, and save the 10 one-time recovery codes. After that, every sign-in asks for
Google, then a code from the app.

**Locked out?** (lost phone *and* recovery codes): reset MFA for your account with the
`sqlcipher` CLI (`sudo apt install sqlcipher`; plain `sqlite3` can't open the encrypted database). You'll
enroll again on your next sign-in:

```sh
docker compose stop
docker compose cp app:/data/budget.db ./budget.db      # Docker; skip for cargo run
sqlcipher budget.db <<SQL
PRAGMA key = "x'$(grep ^DATABASE_KEY= backend/.env | cut -d= -f2)'";
UPDATE users SET totp_secret = NULL, totp_last_step = NULL WHERE email = 'you@gmail.com';
DELETE FROM sessions;
SQL
docker compose cp ./budget.db app:/data/budget.db && rm budget.db && docker compose start
```

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

## Access it from anywhere (Cloudflare Tunnel)

To open the app from any browser, with no VPN, run a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
on the machine that hosts it. `cloudflared` makes an outgoing connection to Cloudflare, and Cloudflare
serves your domain from it. That means:

- no router ports to open
- your home IP stays hidden
- Cloudflare handles HTTPS (TLS 1.2+)
- it's free apart from the domain

The app stays on `127.0.0.1:3000`, so the tunnel is the only way in from outside the machine.
(Tailscale is a VPN, so every device would need it installed. Tailscale Funnel can expose a site,
but only on a `*.ts.net` address.)

1. **Domain.** Add a domain to Cloudflare. Buy one there at cost, or point an existing domain's
   nameservers to Cloudflare. These steps use `budget.example.com`.
2. **Tunnel.** Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
   on the host itself, not in Docker, so it can reach the loopback port. Then run:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create open-budget        # prints the tunnel ID and writes its credentials file
   cloudflared tunnel route dns open-budget budget.example.com
   ```

   Create `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: <tunnel ID>
   credentials-file: /home/<you>/.cloudflared/<tunnel ID>.json
   ingress:
     - hostname: budget.example.com
       service: http://localhost:3000
     - service: http_status:404
   ```

   Test it with `cloudflared tunnel run open-budget`. Then install it as a service so it starts on
   boot: `sudo cloudflared --config ~/.cloudflared/config.yml service install`.
3. **App.** In `backend/.env`, set `PUBLIC_URL=https://budget.example.com`, then run
   `docker compose up -d`. The app builds the Google sign-in return address from `PUBLIC_URL`, and an
   `https` URL marks the session cookie HTTPS-only.
4. **Google.** In the OAuth client (see [Google sign-in](#google-sign-in)), add
   `https://budget.example.com/api/auth/google/callback` under **Authorized redirect URIs**.
5. **Plaid.** In the Plaid Dashboard, enter `https://budget.example.com` as the **Application URL**.
   Some institutions (e.g. Fidelity) need it before you can register with them. For OAuth banks, set
   `PLAID_REDIRECT_URI=https://budget.example.com/oauth` and add the same URI in the dashboard.
6. **Optional: Cloudflare Access.** In Cloudflare Zero Trust, add a self-hosted Access application for
   `budget.example.com` with a policy that allows only your email. Cloudflare then asks for an email
   code or Google sign-in before any request reaches your machine, so bots and scanners never touch
   the app. The app's own Google sign-in, `ALLOWED_EMAILS` and authenticator code still apply.

Keep the host's OS updated. Keep `DATABASE_KEY` and a copy of the database backup somewhere other than
the host: without the key, the encrypted database can't be read.

## Security

- **Sign-in:** Google OpenID Connect (authorization code + PKCE, state and nonce checked), restricted
  to `ALLOWED_EMAILS`, **plus** a required TOTP code (Google Authenticator). Codes can't be replayed,
  and 5 wrong codes end the sign-in attempt. Recovery codes are single-use and stored hashed.
- **Sessions:** random tokens; only their SHA-256 hash is stored. The cookie is `HttpOnly` and
  `SameSite=Strict` (blocks CSRF), and `Secure` when served over HTTPS. Sessions last 7 days.
- **Encrypted at rest:** the whole database (Plaid tokens, accounts, balances, transactions, sign-in
  data, indexes and WAL) is AES-256 encrypted with SQLCipher. The key is `DATABASE_KEY` in
  `backend/.env`. **Back it up off the machine**: without it the data can't be recovered. An unencrypted
  database from an older version is converted automatically on startup.
- `cargo run` binds to `127.0.0.1`, and `docker-compose.yml` publishes the port on the host's loopback
  only. If you expose the app beyond this machine, put it behind HTTPS (set `PUBLIC_URL=https://...`).
- `backend/.env` and `*.db` files are git-ignored. Never commit them.
