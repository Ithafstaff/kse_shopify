# Account Request Public Email Acceptance Design

**Date:** 2026-08-13
**Status:** Approved

## Goal

Allow any customer with a valid email address to submit an account request through the Contact Us page. The temporary test-only restriction for `gerald.latagan@gmail.com` must no longer block real customers.

## Existing behavior

The backend already normalizes and validates the submitted email address. It requires an email-shaped value with a maximum length of 254 characters. After validation, it currently checks `ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL` and rejects every other address before sending either Resend message.

## Design

- Remove the applicant allowlist check and its rejection message from `AccountRequestService`.
- Keep `ACCOUNT_REQUEST_ENABLED` as the emergency feature switch.
- Keep the existing per-email rate limit of three valid submissions in a rolling 15-minute window.
- Keep the existing validation, header-injection protection, email templates, Resend delivery, recipients, reply-to behavior, and failure responses unchanged.
- Do not change the Shopify theme or GraphQL contract.

The now-unused Railway variable `ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL` can be removed after the new backend deployment is verified. No replacement wildcard value is needed.

## Testing

Update the account-request unit tests to:

1. Prove a valid email different from the former test address reaches both delivery calls.
2. Preserve coverage for malformed emails and other invalid input.
3. Preserve coverage for the feature switch, rate limit behavior, message ordering, escaping, and delivery failures.

Run the account-request test suite, the full backend Jest suite, the TypeScript build, and `git diff --check` before handoff.

## Scope exclusions

This change does not add IP-based throttling, CAPTCHA, email verification, or changes to the shipping-quote workflow. Those can be separate security or product decisions if public-form abuse becomes a concern.
