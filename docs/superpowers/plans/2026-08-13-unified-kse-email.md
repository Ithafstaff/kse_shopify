# Unified KSE Transactional Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one KSE-branded HTML email shell to account-request and shipping-quote messages while keeping request IDs internal-only for account requests.

**Architecture:** Add a small pure `buildKseEmailLayout` renderer under `src/email` that accepts a title, preheader, and already-escaped body HTML. Wrap the existing account-request templates and the two shipping-quote message bodies with that renderer; preserve all existing plain-text content except for removing the customer-facing account request ID.

**Tech Stack:** NestJS, TypeScript, Jest, Resend Email API, inline HTML email CSS.

## Global Constraints

- Apply the shared presentation to the account-request internal/customer messages and shipping-quote internal/customer messages.
- Use `New Website Account Request - [Business] - [Request ID]` for the internal account-request subject.
- Use `We Received Your KSE Account Request` for the customer account-request subject.
- Keep request IDs in internal logs, the internal account-request message, and the GraphQL result; omit them from the customer account-request message.
- Keep recipients, reply-to addresses, Resend delivery, plain-text fallback behavior, escaping, validation, rate limiting, and failure semantics unchanged.
- Do not modify the Shopify theme, Google autocomplete, or Google attribution.

---

### Task 1: Add the shared KSE email layout

**Files:**
- Create: `src/email/kse-email-layout.ts`
- Test: `src/email/kse-email-layout.spec.ts`

**Interfaces:**
- Consumes: `buildKseEmailLayout({ title, preheader, body }): string`.
- Produces: Complete email HTML containing the shared KSE header, white content card, supplied title, supplied body, and footer.

- [ ] **Step 1: Write the failing layout test**

Create `src/email/kse-email-layout.spec.ts`:

```ts
import { buildKseEmailLayout } from './kse-email-layout';

describe('buildKseEmailLayout', () => {
  it('renders the shared KSE shell around the supplied content', () => {
    const html = buildKseEmailLayout({
      title: 'Shipping Quote Request Received',
      preheader: 'Shipping Quote Request Received - Order #D1001',
      body: '<p>Body content</p>',
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('KSE SUPPLIERS');
    expect(html).toContain('Shipping Quote Request Received');
    expect(html).toContain('Shipping Quote Request Received - Order #D1001');
    expect(html).toContain('<p>Body content</p>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('background-color:#951828');
    expect(html).toContain('background-color:#ffffff');
    expect(html).toContain('KSE Suppliers');
  });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```powershell
npx jest src/email/kse-email-layout.spec.ts --runInBand
```

Expected: the test fails because `src/email/kse-email-layout.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal shared renderer**

Create `src/email/kse-email-layout.ts`:

```ts
export interface KseEmailLayoutOptions {
  title: string;
  preheader: string;
  body: string;
}

export function buildKseEmailLayout({
  title,
  preheader,
  body,
}: KseEmailLayoutOptions): string {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin:0; padding:0; background-color:#f3f4f6; color:#222222; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${preheader}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background-color:#f3f4f6;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:620px; background-color:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
                <tr>
                  <td style="padding:22px 28px; background-color:#951828; color:#ffffff;">
                    <div style="font-size:13px; font-weight:bold; letter-spacing:1.6px; line-height:1.2; text-transform:uppercase;">KSE Suppliers</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 28px 26px;">
                    <h1 style="margin:0 0 24px; color:#951828; font-size:25px; line-height:1.25; font-weight:700;">${title}</h1>
                    ${body}
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 28px; border-top:1px solid #e5e7eb; background-color:#fafafa; color:#6b7280; font-size:12px; line-height:1.5;">
                    KSE Suppliers<br>
                    Thank you for choosing KSE Suppliers.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}
```

- [ ] **Step 4: Run the layout test and verify it passes**

Run:

```powershell
npx jest src/email/kse-email-layout.spec.ts --runInBand
```

Expected: 1 test passes.

### Task 2: Restyle account-request emails and hide the customer request ID

**Files:**
- Modify: `src/account-request/email-templates.ts`
- Modify: `src/account-request/account-request.service.spec.ts`

**Interfaces:**
- Consumes: `buildKseEmailLayout` from Task 1.
- Produces: Title-cased account-request subjects, shared HTML presentation, and customer-facing content without `Request ID`.

- [ ] **Step 1: Write the failing account-request assertions**

In `src/account-request/account-request.service.spec.ts`, change the internal subject assertion to:

```ts
expect(sendMessage.mock.calls[0][0].subject).toMatch(
  /^New Website Account Request - Gerald Linen Supply - KSE-[0-9A-F]{8}$/,
);
```

Change the customer subject assertion to:

```ts
subject: 'We Received Your KSE Account Request',
```

Add these assertions after the first successful request:

```ts
const internalMessage = sendMessage.mock.calls[0][0];
const customerMessage = sendMessage.mock.calls[1][0];

expect(internalMessage.html).toContain('KSE SUPPLIERS');
expect(internalMessage.html).toContain('New Website Account Request');
expect(internalMessage.html).toContain('Request ID');
expect(customerMessage.html).toContain('KSE SUPPLIERS');
expect(customerMessage.html).toContain('We Received Your KSE Account Request');
expect(customerMessage.html).not.toContain('Request ID');
expect(customerMessage.text).not.toContain('Request ID');
```

- [ ] **Step 2: Run the account-request test and verify the expected failures**

Run:

```powershell
npx jest src/account-request/account-request.service.spec.ts --runInBand
```

Expected: the test fails on the current lowercase internal subject, the lowercase customer subject, and the customer HTML/text still containing `Request ID`.

- [ ] **Step 3: Implement the account-request template changes**

In `src/account-request/email-templates.ts`:

1. Import `buildKseEmailLayout` from `../email/kse-email-layout`.
2. Change the internal subject to:

```ts
const subject = `New Website Account Request - ${input.businessName} - ${requestId}`;
```

3. Wrap the internal details table with:

```ts
html: buildKseEmailLayout({
  title: 'New Website Account Request',
  preheader: subject,
  body: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
      ${rows
        .map(
          ([label, value]) => `
            <tr>
              <td style="width:34%; padding:11px 12px 11px 0; border-bottom:1px solid #e5e7eb; color:#4b5563; font-size:13px; line-height:1.4; font-weight:700; vertical-align:top;">${escapeHtml(label)}</td>
              <td style="padding:11px 0; border-bottom:1px solid #e5e7eb; color:#111827; font-size:14px; line-height:1.4; vertical-align:top;">${escapeHtml(value)}</td>
            </tr>
          `,
        )
        .join('')}
    </table>
  `,
}),
```

4. Change the customer subject to `We Received Your KSE Account Request`.
5. Remove only the customer plain-text `Request ID` line and the customer HTML `Request ID` paragraph.
6. Wrap the remaining customer body in `buildKseEmailLayout` with title `We Received Your KSE Account Request`, preheader equal to the subject, and the existing greeting, explanation, business, and comments content using inline paragraph styles.
7. Keep the internal request ID in the internal subject, internal text, internal HTML table, service logs, and result object.

- [ ] **Step 4: Run the account-request tests and verify they pass**

Run:

```powershell
npx jest src/account-request/account-request.service.spec.ts --runInBand
```

Expected: all account-request tests pass, including validation, rate limiting, escaping, delivery ordering, exact subject casing, and customer/internal request-ID visibility.

### Task 3: Apply the shared shell and presentation refinements to shipping-quote emails

**Files:**
- Modify: `src/app.service.ts`
- Modify: `src/app.service.shipping-quote.spec.ts`

**Interfaces:**
- Consumes: `buildKseEmailLayout` from Task 1 and existing shipping-quote data/escaping logic.
- Produces: Shared KSE presentation for customer and internal shipping-quote messages with unchanged subjects, recipients, and delivery behavior.

- [ ] **Step 1: Write the failing shipping presentation assertions**

In `src/app.service.shipping-quote.spec.ts`, add these assertions to the customer-message test:

```ts
expect(customerMessage.html).toContain('KSE SUPPLIERS');
expect(customerMessage.html).toContain('Shipping Quote Request Received');
expect(customerMessage.html).toContain('Item');
expect(customerMessage.html).toContain('Qty');
expect(customerMessage.html).toContain('Unit price');
expect(customerMessage.html).toContain('Total');
expect(customerMessage.html).toContain('text-align:right');
expect(customerMessage.html).toContain('Order subtotal');
```

Add these assertions to the internal-message test:

```ts
expect(internalMessage.html).toContain('KSE SUPPLIERS');
expect(internalMessage.html).toContain('Shipping Quote Request');
expect(internalMessage.html).toContain('View Draft Order');
```

- [ ] **Step 2: Run the shipping-quote test and verify the expected failures**

Run:

```powershell
npx jest src/app.service.shipping-quote.spec.ts --runInBand
```

Expected: the existing subject/content tests pass, but the new shared-shell and table-header assertions fail because the current shipping HTML has no shared KSE shell or table headers.

- [ ] **Step 3: Implement the shipping-quote HTML presentation changes**

In `src/app.service.ts`:

1. Import `buildKseEmailLayout` from `./email/kse-email-layout`.
2. Replace the current customer HTML wrapper with `buildKseEmailLayout` using title `Shipping Quote Request Received` and the existing escaped address/order content.
3. Add an order-table header row with `Item`, `Qty`, `Unit price`, and `Total`.
4. Keep item values escaped and align quantity/price/total cells with inline `text-align:right` or `text-align:center` styles.
5. Render the subtotal in a separate two-cell presentation row with a lightly shaded background and right-aligned amount.
6. Keep the existing customer text body unchanged.
7. Replace the current internal HTML wrapper with `buildKseEmailLayout` using title `Shipping Quote Request`.
8. Keep all existing internal operational fields and draft-order URL, presenting the URL as a maroon inline button while retaining the same destination.
9. Keep the existing subjects, recipients, `replyTo` behavior, concurrent `Promise.all`, sanitized error logging, and thrown failure message unchanged.

- [ ] **Step 4: Run the shipping-quote tests and verify they pass**

Run:

```powershell
npx jest src/app.service.shipping-quote.spec.ts --runInBand
```

Expected: all shipping-quote tests pass, including content escaping, discounted pricing, recipients, sender, failure propagation, and the new presentation assertions.

### Task 4: Complete backend verification

**Files:**
- Verify: `src/email/kse-email-layout.ts`
- Verify: `src/account-request/email-templates.ts`
- Verify: `src/app.service.ts`
- Verify: `src/account-request/account-request.service.spec.ts`
- Verify: `src/app.service.shipping-quote.spec.ts`

- [ ] **Step 1: Run all backend tests**

Run:

```powershell
npm test -- --runInBand
```

Expected: every Jest suite passes with zero failures.

- [ ] **Step 2: Build the NestJS backend**

Run:

```powershell
npm run build
```

Expected: the TypeScript/NestJS build exits with code 0.

- [ ] **Step 3: Check the diff and request-ID scope**

Run:

```powershell
git diff --check
rg -n "Request ID|requestId|New Website Account Request|We Received Your KSE Account Request" src/account-request src/email
```

Expected: no whitespace errors; internal templates/service logs retain request IDs; the customer account template has no `Request ID` in its text or HTML; both title-cased subjects are present.

- [ ] **Step 4: Inspect representative HTML output**

Use the focused Jest message captures or a local Node preview to inspect one account-request and one shipping-quote email at desktop and narrow widths. Confirm the KSE maroon header, white card, left alignment, label/value spacing, order-table alignment, subtotal emphasis, and footer are readable without changing message recipients or content.
