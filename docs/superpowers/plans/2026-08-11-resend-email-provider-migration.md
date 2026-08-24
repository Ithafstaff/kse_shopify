# Resend Email Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route shipping-quote and account-request transactional emails through the verified Resend domain while preserving existing templates, recipients, validation, frontend behavior, and failure semantics.

**Architecture:** Add a shared `ResendMailService` that sends provider-neutral email messages through Resend's HTTPS API using the existing Axios dependency. Inject that service into the shipping-quote and account-request workflows; keep `gmail-mail.service.ts` and the old Nodemailer code outside the migration path until production Resend delivery is verified.

**Tech Stack:** NestJS, TypeScript, Axios, ConfigService, Jest, Shopify GraphQL, Resend Email API.

## Global Constraints

- Use `https://api.resend.com/emails` over HTTPS; do not add the Resend SDK dependency.
- Read `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_REPLY_TO` through `ConfigService`.
- Use `EMAIL_FROM=KSE Suppliers <orders@notifications.ksesuppliers.com>` for every migrated message.
- Use `ACCOUNT_REQUEST_RECIPIENT=orders@ksesuppliers.com` for the account-request recipient.
- Keep the existing account-request feature flag and controlled applicant allowlist.
- Send two separate messages per workflow; do not combine customer and internal content.
- Preserve shipping-quote concurrent sending and failure propagation.
- Preserve account-request internal-first ordering and partial-failure behavior.
- Never log API keys, message bodies, customer data, or raw provider response bodies.
- Do not change Shopify theme behavior or Shopify-native email flows.
- Do not remove `src/account-request/gmail-mail.service.ts` or unrelated Nodemailer code during this migration.
- Preserve unrelated existing modifications in `src/app.service.ts` and `src/app.service.spec.ts`.
- Do not add automatic retries or a new idempotency system.

---

### Task 1: Add and test the shared Resend mail service

**Files:**
- Create: `src/email/resend-mail.service.ts`
- Create: `src/email/resend-mail.service.spec.ts`
- Create: `src/email/email.module.ts`

**Interfaces:**
- Consumes: `ConfigService` values `RESEND_API_KEY` and `EMAIL_FROM`.
- Produces: `ResendMailService.sendMessage(message: ResendMailMessage): Promise<{ id: string }>`.

Define the message shape in `resend-mail.service.ts`:

```ts
export interface ResendMailMessage {
  from?: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}
```

`from` is optional for callers, but the service must always use `EMAIL_FROM` when it is omitted. The migrated workflows will pass the configured value explicitly so the resulting message object remains inspectable in their tests.

- [ ] **Step 1: Write failing provider tests**

Add tests that construct `ResendMailService` with a mocked `ConfigService` and mock `axios.post`.

Test these exact behaviors:

```ts
const validMessage = {
  to: 'customer@example.com',
  replyTo: 'cs@ksesuppliers.com',
  subject: 'Subject',
  text: 'Plain text',
  html: '<p>HTML</p>',
};

const configService = {
  get: jest.fn((key: string) =>
    ({
      RESEND_API_KEY: 're_test_key',
      EMAIL_FROM: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
    })[key],
  ),
};

const service = new ResendMailService(configService as unknown as ConfigService);
const serviceWithMissingApiKey = new ResendMailService({
  get: jest.fn((key: string) =>
    ({
      EMAIL_FROM: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
    })[key],
  ),
} as unknown as ConfigService);

it('posts a Resend message with configured sender and reply-to', async () => {
  await service.sendMessage(validMessage);

  expect(axios.post).toHaveBeenCalledWith(
    'https://api.resend.com/emails',
    {
      from: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
      to: ['customer@example.com'],
      reply_to: 'cs@ksesuppliers.com',
      subject: 'Subject',
      text: 'Plain text',
      html: '<p>HTML</p>',
    },
    {
      headers: {
        Authorization: 'Bearer re_test_key',
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    },
  );
});

it('returns the Resend message id', async () => {
  await expect(service.sendMessage(validMessage)).resolves.toEqual({
    id: 'resend-message-id',
  });
});

it('rejects without making a request when the API key is missing', async () => {
  await expect(serviceWithMissingApiKey.sendMessage(validMessage)).rejects.toThrow(
    'RESEND_API_KEY is not configured.',
  );
  expect(axios.post).not.toHaveBeenCalled();
});

it('throws sanitized provider diagnostics without exposing the raw response', async () => {
  (axios.post as jest.Mock).mockRejectedValue(
    Object.assign(new Error('provider secret response'), {
      code: 'ERR_BAD_RESPONSE',
      response: { status: 401, data: { secret: 'do-not-log' } },
    }),
  );

  await expect(service.sendMessage(validMessage)).rejects.toMatchObject({
    message: 'Resend email delivery failed.',
    code: 'ERR_BAD_RESPONSE',
    statusCode: 401,
  });
});
```

- [ ] **Step 2: Run the provider tests and confirm the expected red state**

Run:

```powershell
npx jest src/email/resend-mail.service.spec.ts --runInBand
```

Expected result: the suite fails because `ResendMailService` does not exist yet.

- [ ] **Step 3: Implement the minimal HTTPS provider client**

Implement these behaviors:

1. Require `RESEND_API_KEY` before calling Axios.
2. Require `EMAIL_FROM` when `message.from` is omitted.
3. POST to `https://api.resend.com/emails` with `to` as a one-element array.
4. Include `reply_to` only when `replyTo` is provided.
5. Use a 15-second Axios timeout.
6. Return `response.data.id`.
7. On failure, throw an `Error` with message `Resend email delivery failed.`, copy only `error.code` and `error.response?.status` to `code` and `statusCode`, and omit the raw provider response.

Use a Nest `@Injectable()` service and an `EmailModule` that provides and exports it.

- [ ] **Step 4: Run the provider tests and confirm green**

Run:

```powershell
npx jest src/email/resend-mail.service.spec.ts --runInBand
```

Expected result: all provider tests pass.

- [ ] **Step 5: Commit only the new provider files if staging can exclude pre-existing edits**

The working tree already contains user changes in `src/app.service.ts` and `src/app.service.spec.ts`. Do not stage those files in this task's commit.

### Task 2: Migrate the account-request workflow

**Files:**
- Modify: `src/account-request/account-request.service.ts`
- Modify: `src/account-request/account-request.service.spec.ts`
- Modify: `src/account-request/account-request.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `ResendMailService` from Task 1.
- Produces: the existing `requestAccount(input)` behavior and GraphQL response shape.

- [ ] **Step 1: Change the account-request tests to describe Resend configuration and run them red**

Update the test double type from `GmailMailService` to `ResendMailService` and replace the Gmail sender values with:

```ts
EMAIL_FROM: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
EMAIL_REPLY_TO: 'cs@ksesuppliers.com',
ACCOUNT_REQUEST_RECIPIENT: 'orders@ksesuppliers.com',
```

Return `{ id: 'resend-message-id' }` from the mocked `sendMessage` method. Update the successful-send assertions to expect:

```ts
from: 'KSE Suppliers <orders@notifications.ksesuppliers.com>'
```

for both messages, `replyTo: 'gerald.latagan@gmail.com'` for the internal message, and `replyTo: 'cs@ksesuppliers.com'` for the customer acknowledgment. Remove test dependencies on `GMAIL_SENDER_EMAIL`, `GMAIL_SENDER_NAME`, and `GMAIL_REPLY_TO`.

Run:

```powershell
npx jest src/account-request/account-request.service.spec.ts --runInBand
```

Expected result: the suite fails because the service still imports and injects `GmailMailService` and still reads Gmail configuration.

- [ ] **Step 2: Replace the account-request provider dependency**

In `account-request.service.ts`:

1. Import `ResendMailService`.
2. Inject it under the name `resendMailService`.
3. Read `EMAIL_FROM` and `EMAIL_REPLY_TO` instead of the three Gmail sender settings.
4. Keep `ACCOUNT_REQUEST_RECIPIENT` and all validation/allowlist/rate-limit logic unchanged.
5. Send the internal message first with the applicant email as `replyTo`.
6. Send the customer acknowledgment second with `EMAIL_REPLY_TO` or the configured sender as fallback.
7. Preserve the existing sanitized failure responses and ordering.

In `account-request.module.ts`, import `EmailModule`, remove `GmailMailService` from the provider list, and keep only the resolver and account-request service as local providers.

In `app.module.ts`, import `EmailModule` so `AppService` and the account-request module can resolve the shared provider.

- [ ] **Step 3: Run the focused account-request tests and confirm green**

Run:

```powershell
npx jest src/account-request/account-request.service.spec.ts --runInBand
```

Expected result: all account-request tests pass, including internal-first ordering and both failure paths.

- [ ] **Step 4: Commit only account-request changes if staging can exclude pre-existing edits**

Do not delete `src/account-request/gmail-mail.service.ts` or remove Gmail credentials yet. The legacy service remains available but unused until production verification.

### Task 3: Migrate shipping-quote delivery

**Files:**
- Modify: `src/app.service.ts`
- Modify: `src/app.service.shipping-quote.spec.ts`
- Modify: `src/app.service.spec.ts` only where constructor calls require the new dependency stub.

**Interfaces:**
- Consumes: `ResendMailService.sendMessage` from Task 1.
- Produces: the existing `sendShippingQuoteEmails` success and failure behavior.

- [ ] **Step 1: Replace the Nodemailer test double with a Resend test double and run the focused suite red**

In `app.service.shipping-quote.spec.ts`:

1. Remove the `nodemailer` mock and import `ResendMailService`.
2. Replace `sendMail` with `sendMessage`.
3. Add configuration values:

```ts
EMAIL_FROM: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
EMAIL_REPLY_TO: 'cs@ksesuppliers.com',
```

4. Construct `AppService` with the mocked Resend service.
5. Assert the customer message uses the Resend sender and `replyTo: 'cs@ksesuppliers.com'`.
6. Assert the internal message uses the Resend sender, `orders@ksesuppliers.com`, and no `replyTo` property.
7. Preserve all existing subject, HTML, escaping, order-detail, and failure assertions.
8. Replace the SMTP timeout test with a Resend request-failure test that expects sanitized `{ message, code, statusCode }` diagnostics.

Run:

```powershell
npx jest src/app.service.shipping-quote.spec.ts --runInBand
```

Expected result: the suite fails because `sendShippingQuoteEmails` still creates and uses Nodemailer.

- [ ] **Step 2: Inject the shared mail service without disturbing existing AppService behavior**

Add `ResendMailService` as the second constructor dependency of `AppService`. Update each direct `new AppService(...)` call in `app.service.spec.ts` to pass a minimal `{ sendMessage: jest.fn() }` test double while preserving the file's existing pagination and account-update changes.

In `sendShippingQuoteEmails`:

1. Remove only the Gmail Nodemailer transporter creation and `EMAIL_USER`/`EMAIL_PASS` reads from this method.
2. Read `EMAIL_FROM` and `EMAIL_REPLY_TO` from `ConfigService`.
3. Build the existing customer and internal HTML templates unchanged.
4. Send the customer message through `resendMailService.sendMessage` with `to: customerEmail`, the configured sender, and `replyTo: EMAIL_REPLY_TO`.
5. Send the internal message through `resendMailService.sendMessage` with `to: orders@ksesuppliers.com`, the configured sender, and no `replyTo`.
6. Keep the two calls inside `Promise.all`.
7. Preserve the success log and boolean return.
8. Log only `message`, `code`, and `statusCode` from the sanitized provider error, then throw `Failed to send shipping quote emails.`.

Do not change `placeOrderEmail` or remove the top-level Nodemailer import if that method still uses it.

- [ ] **Step 3: Run the focused shipping-quote tests and confirm green**

Run:

```powershell
npx jest src/app.service.shipping-quote.spec.ts --runInBand
```

Expected result: all shipping-quote tests pass, including both message templates, escaping, reply-to routing, concurrent failure propagation, and sanitized diagnostics.

- [ ] **Step 4: Commit only shipping-quote changes if staging can exclude pre-existing edits**

If selective staging would include the user's existing pagination/account-update changes, leave the implementation changes uncommitted and report that clearly instead of committing unrelated work.

### Task 4: Run full verification and prepare the Resend handoff

**Files:**
- Modify: none unless a test exposes an implementation defect.
- Inspect: `src/account-request/gmail-mail.service.ts`, `src/app.service.ts`, `package.json`, `KSE-Improvements/tests/account-request-contact-form.test.cjs`.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified local implementation and exact Railway configuration instructions; no secret is created or stored by the agent.

- [ ] **Step 1: Run all backend tests**

Run:

```powershell
npm test -- --runInBand
```

Expected result: all backend suites pass with zero failed tests.

- [ ] **Step 2: Build the NestJS backend**

Run:

```powershell
npm run build
```

Expected result: the NestJS build exits with code 0.

- [ ] **Step 3: Run the existing Contact Us theme regression test**

Run:

```powershell
node --test tests/account-request-contact-form.test.cjs
```

Expected result: all account-request Contact Us tests pass without theme changes.

- [ ] **Step 4: Inspect the final diff and runtime references**

Confirm:

1. Resend is used by both migrated workflows.
2. `GmailMailService` is no longer registered or injected.
3. `gmail-mail.service.ts` remains present but unused.
4. `placeOrderEmail` and unrelated Nodemailer behavior were not changed.
5. No API key, provider response body, or customer message body was added to code or logs.
6. Existing user changes in `src/app.service.ts` and `src/app.service.spec.ts` remain present.

- [ ] **Step 5: Provide the user’s Railway configuration handoff**

After local verification, tell the user to create a restricted Resend sending key and add these non-secret values in Railway:

```text
EMAIL_FROM=KSE Suppliers <orders@notifications.ksesuppliers.com>
EMAIL_REPLY_TO=cs@ksesuppliers.com
ACCOUNT_REQUEST_RECIPIENT=orders@ksesuppliers.com
```

The user adds `RESEND_API_KEY` directly in Railway. The agent must not receive or store it.

- [ ] **Step 6: Stop before production testing**

Do not claim production delivery is working until the user has added the key, deployed the backend, and verified one shipping-quote request and one account request in Resend activity and both inboxes.
