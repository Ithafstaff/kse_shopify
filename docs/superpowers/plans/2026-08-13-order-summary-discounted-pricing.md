# Shipping Quote Email Order Summary Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render discounted customer-facing line-item prices in shipping-quote emails so the order summary matches the draft-order dashboard.

**Architecture:** Keep `AppService.sendShippingQuoteEmails` as the single email-template boundary. Calculate the effective line-item unit price once per rendered item, using the existing base price and line discount fields, then reuse it for both HTML and text output. The draft order's existing `subtotal_price` remains the source for the order subtotal.

**Tech Stack:** NestJS, TypeScript, Jest, Shopify REST draft-order data, Resend email service.

## Global Constraints

- Modify only `src/app.service.ts` and `src/app.service.shipping-quote.spec.ts` for application behavior.
- Preserve both shipping-quote recipients, templates, sender/reply-to values, and error semantics.
- Use test-first development: the regression test must fail before the production change.
- Do not change draft-order creation or the legacy theme price sentinel in this task.

---

### Task 1: Add the discounted line-item regression test

**Files:**
- Modify: `src/app.service.shipping-quote.spec.ts:42-68` for the mocked discounted draft line item.
- Modify: `src/app.service.shipping-quote.spec.ts:75-130` with the regression test.

**Interfaces:**
- Consumes: `AppService.sendShippingQuoteEmails` and the existing `sendMessage` test double.
- Produces: A failing test proving that a base price of `499.99` with a fixed discount of `472.00` renders as `27.99` per item and in the line total.

- [ ] **Step 1: Add a focused discounted draft-order fixture and test.**

Use a one-item fixture in the new test so the expected arithmetic is unambiguous:

```ts
it('uses the discounted customer price in both order-summary messages', async () => {
  jest.spyOn(service, 'getDraftOrderDetails').mockResolvedValueOnce({
    name: '#D1002',
    currency: 'USD',
    subtotal_price: '27.99',
    total_price: '27.99',
    customer: { first_name: 'Ada', last_name: 'Lovelace' },
    line_items: [
      {
        title: 'Global Collection T180 Sheets & Pillowcases',
        quantity: 1,
        price: '499.99',
        applied_discount: { value: '472.00', value_type: 'FIXED_AMOUNT' },
      },
    ],
  });

  await (service as any).sendShippingQuoteEmails(
    'customer-123',
    'gid://shopify/DraftOrder/1002',
    'customer@example.com',
    shippingAddress,
  );

  for (const [{ html, text }] of sendMessage.mock.calls) {
    expect(html).toContain('27.99 USD each');
    expect(html).toContain('27.99 USD total');
    expect(html).not.toContain('499.99 USD each');
    expect(text).toContain('27.99 USD each');
    expect(text).toContain('27.99 USD total');
  }
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure.**

Run: `npx jest src/app.service.shipping-quote.spec.ts --runInBand`

Expected: the new test fails because the current formatter renders `499.99 USD each` and calculates the line total from the undiscounted base price.

### Task 2: Implement the minimum pricing correction

**Files:**
- Modify: `src/app.service.ts:4136-4162` in `sendShippingQuoteEmails`.

**Interfaces:**
- Consumes: REST line-item fields `quantity`, `price`, `variant.price`, `line_price`, and `applied_discount`.
- Produces: Existing HTML/text email options with the effective discounted unit price and line total.

- [ ] **Step 1: Calculate effective line-item pricing once per mapping.**

For each line item, preserve the current base-price fallback and quantity handling. Apply `FIXED_AMOUNT` or `PERCENTAGE` discounts like the customer dashboard, clamp negative prices to zero, and use the current `line_price` fallback only when no supported line discount is present. Reuse the resulting `quantity`, `unitPrice`, and `lineTotal` in both product renderers.

- [ ] **Step 2: Run the focused test and verify it passes.**

Run: `npx jest src/app.service.shipping-quote.spec.ts --runInBand`

Expected: all shipping-quote tests pass, including the discounted-price regression.

### Task 3: Verify the complete backend change

**Files:**
- Inspect: `src/app.service.ts` and `src/app.service.shipping-quote.spec.ts`.

- [ ] **Step 1: Run the full Jest suite.**

Run: `npm test -- --runInBand`

Expected: all backend test suites pass with zero failures.

- [ ] **Step 2: Run the NestJS build.**

Run: `npm run build`

Expected: the TypeScript/NestJS build exits successfully.

- [ ] **Step 3: Inspect the final diff and status.**

Run: `git diff --check; git diff -- src/app.service.ts src/app.service.shipping-quote.spec.ts; git status --short`

Expected: only the focused test and formatter changes are present, with no whitespace errors.
