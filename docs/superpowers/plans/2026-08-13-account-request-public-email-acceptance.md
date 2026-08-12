# Account Request Public Email Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow every customer with a valid email address to submit an account request while retaining the feature flag, validation, and per-email rate limit.

**Architecture:** Keep the existing `AccountRequestService` as the single owner of account-request validation, throttling, and Resend delivery. Remove only the temporary applicant allowlist decision; do not change the resolver, GraphQL input/output, email templates, or delivery service.

**Tech Stack:** NestJS, TypeScript, Jest, ConfigService, ResendMailService.

## Global Constraints

- Accept any normalized email that passes the existing email validation and 254-character limit.
- Keep `ACCOUNT_REQUEST_ENABLED` as the emergency feature switch.
- Keep the per-email limit of three valid submissions in a rolling 15-minute window.
- Keep header-injection protection, all other input validation, templates, recipients, reply-to behavior, and failure responses unchanged.
- Do not change the Shopify theme or GraphQL contract.
- Do not add IP throttling, CAPTCHA, email verification, or new dependencies.
- Remove the now-unused `ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL` lookup from production code and tests; remove the Railway variable only after deployment verification.

---

### Task 1: Remove the temporary account-request applicant allowlist

**Files:**
- Modify: `src/account-request/account-request.service.spec.ts`
- Modify: `src/account-request/account-request.service.ts`

**Interfaces:**
- Consumes: `AccountRequestService.requestAccount(input: AccountRequestInput): Promise<AccountRequestResult>` and the existing `ResendMailService.sendMessage` test double.
- Produces: The same `requestAccount` result shape and email messages, with valid email addresses no longer filtered by `ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL`.

- [ ] **Step 1: Write the failing regression test for a non-allowlisted valid email**

In `src/account-request/account-request.service.spec.ts`:

1. Remove `ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL` from the test `ConfigService` values.
2. Replace the test named `rejects applicants outside the test allowlist without sending email` with:

```ts
  it('accepts any valid applicant email without an allowlist', async () => {
    const result = await service.requestAccount({
      ...baseInput,
      email: 'customer@example.com',
    });

    expect(result).toEqual({
      success: true,
      message:
        'Your account request has been received. We sent a confirmation to your email address.',
      requestId: expect.any(String),
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0].replyTo).toBe('customer@example.com');
    expect(sendMessage.mock.calls[1][0].to).toBe('customer@example.com');
  });
```

- [ ] **Step 2: Add an explicit regression test for the retained per-email rate limit**

Add this test to the same file:

```ts
  it('limits each email to three valid requests within 15 minutes', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(
        service.requestAccount({
          ...baseInput,
          businessName: `Business ${attempt}`,
        }),
      ).resolves.toEqual({
        success: true,
        message:
          'Your account request has been received. We sent a confirmation to your email address.',
        requestId: expect.any(String),
      });
    }

    await expect(
      service.requestAccount({
        ...baseInput,
        businessName: 'Business 4',
      }),
    ).resolves.toEqual({
      success: false,
      message: 'We could not submit your account request. Please try again later.',
      requestId: expect.any(String),
    });

    expect(sendMessage).toHaveBeenCalledTimes(6);
  });
```

- [ ] **Step 3: Run the focused tests and confirm the new behavior fails for the expected reason**

Run:

```powershell
npx jest src/account-request/account-request.service.spec.ts --runInBand
```

Expected result: the existing production allowlist check rejects `customer@example.com`, so the new acceptance test fails with `success: false` instead of `success: true`. The rate-limit test may also fail at its first request for the same reason. This confirms the tests detect the missing implementation rather than a test typo.

- [ ] **Step 4: Remove the allowlist branch and unused constant from the service**

In `src/account-request/account-request.service.ts`:

1. Delete the `ALLOWLIST_MESSAGE` constant.
2. Delete this block from `requestAccount`, leaving the feature-enabled validation immediately followed by `consumeRateLimit`:

```ts
    if (!this.isAllowedApplicant(normalized.email)) {
      console.warn('Account request rejected by applicant allowlist.', {
        requestId,
      });
      return { success: false, message: ALLOWLIST_MESSAGE, requestId };
    }
```

3. Delete the private `isAllowedApplicant(email: string): boolean` method.
4. Do not change `consumeRateLimit`, `normalize`, `isEnabled`, or any delivery code.

- [ ] **Step 5: Run the focused tests and confirm the implementation passes**

Run:

```powershell
npx jest src/account-request/account-request.service.spec.ts --runInBand
```

Expected result: all account-request tests pass, including acceptance of `customer@example.com`, validation rejection, feature-disabled behavior, rate limiting, message ordering, escaping, and delivery failure behavior.

- [ ] **Step 6: Verify no runtime code or test still reads the obsolete allowlist variable**

Run:

```powershell
rg -n "ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL|isAllowedApplicant|ALLOWLIST_MESSAGE" src
```

Expected result: no matches.

- [ ] **Step 7: Commit the focused backend change**

Run:

```powershell
git add src/account-request/account-request.service.ts src/account-request/account-request.service.spec.ts
git commit -m "feat: accept public account request emails"
```

### Task 2: Complete repository verification

**Files:**
- Verify: `src/account-request/account-request.service.ts`
- Verify: `src/account-request/account-request.service.spec.ts`

**Interfaces:**
- Consumes: The committed Task 1 implementation.
- Produces: Fresh evidence that the backend builds and the complete test suite remains green.

- [ ] **Step 1: Run the full backend Jest suite**

Run:

```powershell
npx jest --runInBand
```

Expected result: every backend test suite passes with zero failures.

- [ ] **Step 2: Run the TypeScript/Nest build**

Run:

```powershell
npm run build
```

Expected result: the build exits with code 0.

- [ ] **Step 3: Check the final diff for whitespace errors**

Run:

```powershell
git diff --check HEAD~1..HEAD
```

Expected result: no output and exit code 0.

- [ ] **Step 4: Confirm the deployment follow-up**

After the backend commit is pushed and the deployment is verified, remove this Railway variable:

```text
ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL
```

Do not replace it with a wildcard or blank value. Keep `ACCOUNT_REQUEST_ENABLED=true`, `ACCOUNT_REQUEST_RECIPIENT`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and `RESEND_API_KEY` unchanged.
