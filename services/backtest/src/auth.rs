use std::{sync::{Arc, RwLock}, time::{Duration, Instant}};
use axum::{extract::{Request, State}, http::{header, HeaderMap}, middleware::Next, response::Response};
use jsonwebtoken::{decode, decode_header, jwk::{AlgorithmParameters, JwkSet}, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use crate::{db, error::ApiError, AppState};

#[derive(Clone)]
pub struct ClerkAuth {
    issuer: String,
    authorized_parties: Vec<String>,
    client: reqwest::Client,
    cache: Arc<RwLock<(JwkSet, Instant)>>,
}
#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    azp: Option<String>,
}
impl ClerkAuth {
    pub async fn new(issuer: String, authorized_parties: Vec<String>) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;
        let keys = Self::fetch_keys(&client, &issuer).await?;
        Ok(Self { issuer, authorized_parties, client, cache: Arc::new(RwLock::new((keys, Instant::now()))) })
    }
    async fn fetch_keys(client: &reqwest::Client, issuer: &str) -> anyhow::Result<JwkSet> {
        Ok(client.get(format!("{}/.well-known/jwks.json", issuer.trim_end_matches('/')))
            .send().await?.error_for_status()?.json().await?)
    }
    async fn verify(&self, token: &str) -> Result<String, ApiError> {
        let header = decode_header(token).map_err(|_| ApiError::Unauthorized)?;
        if header.alg != Algorithm::RS256 { return Err(ApiError::Unauthorized); }
        let kid = header.kid.ok_or(ApiError::Unauthorized)?;
        let (mut keys, fetched) = self.cache.read().map_err(|_| ApiError::Unauthorized)?.clone();
        // Refresh expired keys, and throttle unknown-kid refreshes to avoid network amplification.
        if fetched.elapsed() >= Duration::from_secs(300)
            || (keys.find(&kid).is_none() && fetched.elapsed() >= Duration::from_secs(30)) {
            keys = Self::fetch_keys(&self.client, &self.issuer).await.map_err(|_| ApiError::Unauthorized)?;
            *self.cache.write().map_err(|_| ApiError::Unauthorized)? = (keys.clone(), Instant::now());
        }
        let jwk = keys.find(&kid).ok_or(ApiError::Unauthorized)?;
        if !matches!(&jwk.algorithm, AlgorithmParameters::RSA(_)) { return Err(ApiError::Unauthorized); }
        let key = DecodingKey::from_jwk(jwk).map_err(|_| ApiError::Unauthorized)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.issuer]);
        validation.set_required_spec_claims(&["exp", "nbf", "iss", "sub"]);
        validation.validate_nbf = true;
        validation.validate_aud = false;
        validation.leeway = 0;
        let claims = decode::<Claims>(token, &key, &validation).map_err(|_| ApiError::Unauthorized)?.claims;
        validate_identity(&claims, &self.authorized_parties)?;
        Ok(claims.sub)
    }
}
fn validate_identity(claims: &Claims, parties: &[String]) -> Result<(), ApiError> {
    if claims.sub.is_empty() || claims.sub.len() > 255 || !claims.sub.starts_with("user_")
        || !claims.sub.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        || !claims.azp.as_ref().is_some_and(|azp| parties.contains(azp)) {
        return Err(ApiError::Unauthorized);
    }
    Ok(())
}
fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    if headers.get_all(header::AUTHORIZATION).iter().count() != 1 { return Err(ApiError::Unauthorized); }
    let value = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).ok_or(ApiError::Unauthorized)?;
    let (scheme, token) = value.split_once(' ').ok_or(ApiError::Unauthorized)?;
    if !scheme.eq_ignore_ascii_case("Bearer") || token.is_empty() || token.chars().any(char::is_whitespace) {
        return Err(ApiError::Unauthorized);
    }
    Ok(token)
}
pub async fn authenticate(State(state): State<AppState>, mut request: Request, next: Next) -> Result<Response, ApiError> {
    let token = bearer_token(request.headers())?;
    let subject = state.auth.verify(token).await?;
    let user_id = db::resolve_clerk_user(&state.pool, &subject).await?;
    request.extensions_mut().insert(user_id);
    Ok(next.run(request).await)
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::{HeaderValue, StatusCode}, response::IntoResponse};
    #[test]
    fn rejects_missing_malformed_and_duplicate_authorization() {
        let mut headers = HeaderMap::new();
        assert!(bearer_token(&headers).is_err());
        for value in ["", "Basic abc", "Bearer", "Bearer ", "Bearer a b", "Bearer a\tb"] {
            headers.insert(header::AUTHORIZATION, HeaderValue::from_str(value).unwrap());
            assert!(bearer_token(&headers).is_err(), "accepted malformed header");
        }
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer abc"));
        assert_eq!(bearer_token(&headers).unwrap(), "abc");
        headers.append(header::AUTHORIZATION, HeaderValue::from_static("Bearer def"));
        assert!(bearer_token(&headers).is_err());
        assert_eq!(ApiError::Unauthorized.into_response().status(), StatusCode::UNAUTHORIZED);
    }
    #[test]
    fn requires_clerk_subject_and_exact_authorized_party() {
        let parties = vec!["https://example.com".to_owned()];
        for (sub, azp) in [("", Some("https://example.com")), ("guest", Some("https://example.com")), ("user_123", None), ("user_123", Some("https://attacker.example")), ("user_123", Some("https://example.com.attacker.example"))] {
            assert!(validate_identity(&Claims { sub: sub.into(), azp: azp.map(str::to_owned) }, &parties).is_err());
        }
        assert!(validate_identity(&Claims { sub: "user_123".into(), azp: Some("https://example.com".into()) }, &parties).is_ok());
    }
    #[tokio::test]
    async fn rejects_malformed_and_non_rs256_tokens_without_network() {
        let auth = ClerkAuth { issuer: "https://clerk.example".into(), authorized_parties: vec!["https://example.com".into()], client: reqwest::Client::new(), cache: Arc::new(RwLock::new((JwkSet { keys: vec![] }, Instant::now()))) };
        for token in ["garbage", "a.b.c", "eyJhbGciOiJIUzI1NiIsImtpZCI6IngifQ.e30.YQ", "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.e30.YQ"] {
            assert!(auth.verify(token).await.is_err());
        }
    }
}
