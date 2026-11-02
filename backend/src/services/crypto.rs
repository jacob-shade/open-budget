//! Small cryptographic helpers: random tokens, hashing, PKCE.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};

/// URL-safe random token with `bytes` bytes of entropy from the OS RNG.
pub fn random_token(bytes: usize) -> String {
    URL_SAFE_NO_PAD.encode(random_bytes(bytes))
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    OsRng.fill_bytes(&mut buf);
    buf
}

/// Base64url SHA-256. Used to store session tokens and recovery codes, and for PKCE S256.
pub fn sha256_b64(input: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(input.as_bytes()))
}

pub fn pkce_challenge(verifier: &str) -> String {
    sha256_b64(verifier)
}

pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before 1970")
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 Appendix B
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn random_tokens_are_unique_and_sized() {
        let a = random_token(32);
        assert_eq!(a.len(), 43); // valid PKCE verifier length (43..=128)
        assert_ne!(a, random_token(32));
    }
}
