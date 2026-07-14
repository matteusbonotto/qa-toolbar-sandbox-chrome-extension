# ADR-0003: signed offline entitlement

Status: accepted — 2026-07-14.

The billing-status Edge Function issues a PS256 token bound to the authenticated user and installation. It contains the effective plan/features, a 24-hour validation window and a 72-hour grace boundary. The private RSA JWK exists only in Supabase secrets; the extension bundles only the public JWK.

The extension does not trust the editable entitlement cache. Offline premium access is reconstructed only after signature, installation, issued-at, commercial expiration and grace validation. Expired or forged tokens fall back to Starter without deleting local workspace data.
