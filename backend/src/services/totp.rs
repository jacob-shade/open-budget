//! TOTP (RFC 6238) compatible with Google Authenticator: HMAC-SHA1, 6 digits, 30-second steps.

use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, KeyInit, Mac};
use qrcode::{QrCode, render::svg};
use sha1::Sha1;
use subtle::ConstantTimeEq;

use crate::services::crypto::{random_bytes, sha256_b64};

pub const ISSUER: &str = "Open Budget";
const STEP_SECS: i64 = 30;
const DIGITS: u32 = 6;
/// Accept the previous and next step too, to tolerate small clock drift.
const SKEW_STEPS: i64 = 1;
const RECOVERY_CODE_COUNT: usize = 10;

/// New random 160-bit secret, base32-encoded (what authenticator apps expect).
pub fn new_secret() -> String {
    BASE32_NOPAD.encode(&random_bytes(20))
}

/// The code for a given time step.
fn code_at(secret: &[u8], step: i64) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(&(step as u64).to_be_bytes());
    let hash = mac.finalize().into_bytes();
    // Dynamic truncation (RFC 4226 §5.3).
    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([hash[offset] & 0x7f, hash[offset + 1], hash[offset + 2], hash[offset + 3]]);
    format!("{:0width$}", bin % 10u32.pow(DIGITS), width = DIGITS as usize)
}

/// Checks `code` against `secret_b32` at `now` (unix seconds).
/// Returns the matched time step, which must be greater than `last_step` so a code can't be reused.
pub fn verify(secret_b32: &str, code: &str, now: i64, last_step: Option<i64>) -> Option<i64> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    if code.len() != DIGITS as usize || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let secret = BASE32_NOPAD.decode(secret_b32.as_bytes()).ok()?;
    let current = now / STEP_SECS;
    (current - SKEW_STEPS..=current + SKEW_STEPS)
        .filter(|step| last_step.is_none_or(|last| *step > last))
        .find(|step| bool::from(code_at(&secret, *step).as_bytes().ct_eq(code.as_bytes())))
}

/// The `otpauth://` URI that authenticator apps import (usually via QR code).
pub fn otpauth_url(secret_b32: &str, account: &str) -> String {
    let enc = |s: &str| {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'@' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    format!(
        "otpauth://totp/{issuer}:{account}?secret={secret_b32}&issuer={issuer}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECS}",
        issuer = enc(ISSUER),
        account = enc(account),
    )
}

pub fn qr_svg(data: &str) -> String {
    QrCode::new(data.as_bytes())
        .expect("otpauth URL fits in a QR code")
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .quiet_zone(true)
        .build()
}

/// Generates recovery codes like `K7Q2M-XP9RD`. Returns (plaintext codes, hashes to store).
pub fn new_recovery_codes() -> (Vec<String>, Vec<String>) {
    // Crockford-style alphabet without easily confused characters (0/O, 1/I/L).
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let codes: Vec<String> = (0..RECOVERY_CODE_COUNT)
        .map(|_| {
            let chars: String = random_bytes(10)
                .iter()
                .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
                .collect();
            format!("{}-{}", &chars[..5], &chars[5..])
        })
        .collect();
    let hashes = codes.iter().map(|c| hash_recovery_code(c)).collect();
    (codes, hashes)
}

/// Normalizes (case, dashes, spaces) before hashing so users can type codes loosely.
pub fn hash_recovery_code(code: &str) -> String {
    let normalized: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    sha256_b64(&normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 Appendix B, SHA1 secret "12345678901234567890" (8-digit vectors truncated to 6).
    const RFC_SECRET: &[u8] = b"12345678901234567890";

    #[test]
    fn matches_rfc6238_vectors() {
        assert_eq!(code_at(RFC_SECRET, 59 / 30), "287082");
        assert_eq!(code_at(RFC_SECRET, 1111111109 / 30), "081804");
        assert_eq!(code_at(RFC_SECRET, 1234567890 / 30), "005924");
        assert_eq!(code_at(RFC_SECRET, 2000000000 / 30), "279037");
    }

    #[test]
    fn verify_accepts_skew_and_rejects_replay() {
        let secret = BASE32_NOPAD.encode(RFC_SECRET);
        let now = 1111111109;
        let step = now / 30;
        assert_eq!(verify(&secret, "081804", now, None), Some(step));
        assert_eq!(verify(&secret, "081 804", now, None), Some(step));
        // Previous step's code is still accepted (clock drift)...
        let prev = code_at(RFC_SECRET, step - 1);
        assert_eq!(verify(&secret, &prev, now, None), Some(step - 1));
        // ...but not once that step (or a later one) has been used.
        assert_eq!(verify(&secret, "081804", now, Some(step)), None);
        assert_eq!(verify(&secret, &prev, now, Some(step - 1)), None);
        // Too old, wrong, or malformed.
        assert_eq!(verify(&secret, &code_at(RFC_SECRET, step - 2), now, None), None);
        assert_eq!(verify(&secret, "000000", now, None), None);
        assert_eq!(verify(&secret, "08180", now, None), None);
        assert_eq!(verify(&secret, "abcdef", now, None), None);
    }

    #[test]
    fn recovery_codes_hash_loosely() {
        let (codes, hashes) = new_recovery_codes();
        assert_eq!(codes.len(), RECOVERY_CODE_COUNT);
        let loose = codes[0].to_lowercase().replace('-', " ");
        assert_eq!(hash_recovery_code(&loose), hashes[0]);
    }

    #[test]
    fn otpauth_url_format() {
        let url = otpauth_url("JBSWY3DPEHPK3PXP", "me+x@gmail.com");
        assert_eq!(
            url,
            "otpauth://totp/Open%20Budget:me%2Bx@gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Open%20Budget&algorithm=SHA1&digits=6&period=30"
        );
    }
}
