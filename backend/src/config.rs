use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub plaid_client_id: String,
    pub plaid_secret: String,
    pub plaid_env: String,
    pub plaid_redirect_uri: Option<String>,
    pub database_url: String,
    pub port: u16,
    /// 127.0.0.1 locally; 0.0.0.0 inside Docker (the host port mapping restricts exposure).
    pub bind_addr: std::net::IpAddr,
    /// Directory of the built frontend to serve (used in the Docker image).
    pub static_dir: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let required = |key: &str| {
            env::var(key)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| format!("missing required env var {key} (see backend/.env.example)"))
        };

        let plaid_env = env::var("PLAID_ENV").unwrap_or_else(|_| "sandbox".into());
        if !matches!(plaid_env.as_str(), "sandbox" | "production") {
            return Err(format!("PLAID_ENV must be 'sandbox' or 'production', got '{plaid_env}'"));
        }

        Ok(Self {
            plaid_client_id: required("PLAID_CLIENT_ID")?,
            plaid_secret: required("PLAID_SECRET")?,
            plaid_env,
            plaid_redirect_uri: env::var("PLAID_REDIRECT_URI").ok().filter(|v| !v.is_empty()),
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://budget.db".into()),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),
            bind_addr: match env::var("BIND_ADDR") {
                Ok(v) => v.parse().map_err(|_| format!("invalid BIND_ADDR '{v}'"))?,
                Err(_) => std::net::IpAddr::from([127, 0, 0, 1]),
            },
            static_dir: env::var("STATIC_DIR").ok().filter(|v| !v.is_empty()),
        })
    }

    pub fn plaid_base_url(&self) -> &'static str {
        match self.plaid_env.as_str() {
            "production" => "https://production.plaid.com",
            _ => "https://sandbox.plaid.com",
        }
    }
}
