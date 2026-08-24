# Resend Email Provider Migration Design

**Date:** 2026-08-11

**Status:** Proposed design for user review

## Goal

Use the verified Resend sending domain to deliver the two transactional emails required by each of these workflows:

1. Shipping quote requests:
   - A customer acknowledgment.
   - An internal shipping-quote request.
2. Website account requests from the Contact Us page:
   - A customer acknowledgment.
   - An internal account-request notification.

The internal recipient for account requests is `orders@ksesuppliers.com`.

## Scope

This migration changes the shipping-quote and account-request backend email transports from Gmail API and Gmail SMTP/Nodemailer to Resend's HTTPS Email API. It preserves the existing email templates, recipients, validation, frontend mutation, and failure semantics.

The Contact Us theme form already calls the `requestAccount` GraphQL mutation. No theme behavior change is required for the provider migration. Theme tests will still be run to confirm that the existing form contract remains intact.

This migration does not:

- Automatically approve or create Shopify customer accounts.
- Add a database or request dashboard.
- Change Shopify-native order, invoice, newsletter, or account-invite email behavior.
- Add automatic retries or a new idempotency system.
- Expose a Resend API key to the Shopify theme or browser.

## Current Context

The shipping-quote workflow currently creates a Gmail Nodemailer transporter inside `AppService.sendShippingQuoteEmails`. It sends the customer and internal messages concurrently and rejects the request if either send fails.

The account-request workflow already validates and normalizes the form, builds separate internal and customer messages, sends the internal message first, then sends the customer acknowledgment. Its transport is currently `GmailMailService`, which uses the Gmail API and OAuth credentials.

The local repository contains no Resend application integration yet. Resend domain verification is complete, but the API key and Railway variables will be added only after the code and tests pass.

## Recommended Architecture

Create one focused `ResendMailService` for outbound transactional delivery. The service will use the existing backend Axios dependency to call `https://api.resend.com/emails` over HTTPS. This avoids adding another runtime dependency while keeping provider-specific authentication and error handling in one place.

The service will expose one provider-neutral operation:

```text
sendMessage({ from, to, replyTo, subject, text, html }): Promise<{ id: string }>
```

The service will:

- Read `RESEND_API_KEY` and `EMAIL_FROM` from `ConfigService`.
- Send the API request with a bearer token and a finite HTTP timeout.
- Use the configured sender for every message.
- Support an optional per-message `Reply-To` address.
- Return the Resend message ID without logging message bodies or secrets.
- Convert provider failures into sanitized diagnostics suitable for the existing workflow logs.

Two separate Resend messages will be sent for each workflow. The customer and internal messages contain different content, and the internal messages contain operational or applicant information that should not be exposed to the customer.

An official Resend SDK remains a possible later implementation, but it is not needed for this migration because the backend already uses Axios for HTTPS API integrations.

## Message Routing

All messages will use:

```text
From: KSE Suppliers <orders@notifications.ksesuppliers.com>
```

| Workflow | Message | Recipient | Reply-To | Existing purpose |
| --- | --- | --- | --- | --- |
| Shipping quote | Customer acknowledgment | Customer email | `cs@ksesuppliers.com` | Confirms that the shipping quote request was received and is being calculated. |
| Shipping quote | Internal request | `orders@ksesuppliers.com` | None; preserve current behavior | Gives staff the order, customer, address, item, and subtotal details needed to prepare the quote. |
| Account request | Customer acknowledgment | Applicant email | `cs@ksesuppliers.com` | Confirms review is pending and does not promise immediate account creation. |
| Account request | Internal notification | `orders@ksesuppliers.com` | Applicant email | Tells the internal order inbox that a customer submitted an account request and allows a direct reply to that applicant. |

The account-request recipient remains configuration-driven through `ACCOUNT_REQUEST_RECIPIENT`. Existing legacy values of `it@hafstaff.com` are redirected to `orders@ksesuppliers.com` by the backend. The shipping-quote internal recipient remains `orders@ksesuppliers.com` to preserve the existing behavior.

## Configuration and Secrets

The implementation will use these Railway values:

```text
RESEND_API_KEY=(created by the user after code verification and stored only in Railway)
EMAIL_FROM=KSE Suppliers <orders@notifications.ksesuppliers.com>
EMAIL_REPLY_TO=cs@ksesuppliers.com
ACCOUNT_REQUEST_RECIPIENT=orders@ksesuppliers.com
```

The existing account-request feature flag and controlled applicant allowlist remain in place for testing. They must be deliberately changed before public production use.

The API key will never be stored in source code, the Shopify theme, tests, screenshots, handoffs, or logs. The user will create and add the key after the implementation tests pass.

Existing Gmail API and SMTP variables will not be removed until production Resend delivery has been verified. They may remain temporarily unused during the cutover. Cleanup will be a separate post-verification step so a failed migration has a reversible fallback in the repository and deployment configuration.

## Backend Changes

Expected implementation files:

- Create `src/email/resend-mail.service.ts` for the shared HTTPS provider client.
- Create `src/email/email.module.ts` and export the mail service to the application modules.
- Modify `src/app.module.ts` to provide the shared mail service.
- Modify `src/app.service.ts` so `sendShippingQuoteEmails` sends both messages through `ResendMailService` instead of creating a Nodemailer Gmail transporter.
- Modify `src/account-request/account-request.module.ts` to use the shared service.
- Modify `src/account-request/account-request.service.ts` so both account-request messages use Resend instead of `GmailMailService`.
- Keep `src/account-request/gmail-mail.service.ts` unused during the cutover; remove it only after successful production verification.
- Update the affected backend tests to mock the shared mail service and assert the same message content and failure semantics.

The old `placeOrderEmail` Nodemailer method will not be changed unless the repository audit confirms that it is part of an in-scope production flow. The migration is limited to shipping-quote and account-request delivery.

## Error and Delivery Semantics

Shipping quote behavior remains:

- Update the draft-order address first.
- Send the customer and internal messages concurrently.
- Return success only when both provider calls resolve.
- Reject the shipping request if either send fails.
- Log only sanitized provider diagnostics.

Account-request behavior remains:

- Validate and normalize the input.
- Send the internal notification first.
- Do not send the customer acknowledgment if the internal send fails.
- If the internal send succeeds but the customer send fails, return the existing customer-email failure response without automatically resending the internal notification.
- Do not add automatic retries during this migration.

Because a concurrent shipping request can have one successful send and one failed send, production testing must inspect Resend activity and both inboxes before retrying. This avoids duplicate messages.

## Test Plan

The implementation will add or update tests for:

1. Resend payload construction, including sender, recipient, reply-to, subject, text, and HTML.
2. Missing API-key configuration without an outbound request.
3. Sanitized provider failures without API keys or message bodies in logs.
4. Shipping-quote customer and internal messages.
5. Shipping-quote failure propagation when either send fails.
6. Account-request internal-first ordering.
7. Account-request customer acknowledgment and internal notification.
8. Account-request behavior when the internal or customer send fails.
9. Existing validation, escaping, allowlist, and rate-limit behavior.

Verification commands:

```powershell
cd D:\hafstaff\kse_shopify
npm test
npm run build

cd D:\hafstaff\KSE-Improvements
node --test tests/account-request-contact-form.test.cjs
```

These tests run without a real Resend API key.

## Rollout Flow

1. User reviews and approves this design.
2. A detailed implementation plan is written.
3. Backend code and tests are changed without any real provider secret.
4. Local backend tests and build pass.
5. User creates a restricted Resend sending key for `notifications.ksesuppliers.com`.
6. User adds the key and test recipient configuration to Railway.
7. The backend is deployed and restarted.
8. One shipping-quote request is submitted and verified in Resend activity and both inboxes.
9. One account-request submission is made using the controlled test applicant and verified in Resend activity and both inboxes.
10. After both workflows succeed, unused Gmail API configuration and obsolete transport code can be removed in a separate cleanup change.

## Acceptance Criteria

The migration is successful when:

- Both workflows deliver their two required messages through Resend.
- Customer messages go only to the submitted customer address.
- Internal messages go to the approved staff recipient.
- The verified Resend sender is used consistently.
- Account-request replies can reach the applicant through `Reply-To`.
- Existing frontend success/failure behavior remains correct.
- Provider errors do not expose secrets or message bodies.
- No API key is present in source code, theme code, or logs.
- No Shopify account is created or approved merely because an account-request email was sent.
