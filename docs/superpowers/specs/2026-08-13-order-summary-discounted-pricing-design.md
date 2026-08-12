# Shipping Quote Email Order Summary Pricing Design

## Goal

Make shipping-quote emails show the same customer-facing line-item price and total as the draft-order dashboard. For the reported order, the line item, merchandise subtotal, and total must reflect `$27.99`, not the `$499.99` base price.

## Root cause

`AppService.sendShippingQuoteEmails` reads the Shopify REST draft-order line item's `price` as the displayed unit price. That field represents the base price for this product line, while the draft order's `applied_discount` contains the customer-specific price adjustment. The email therefore renders `$499.99` for the line even though `subtotal_price` is `$27.99`.

## Design

Keep the existing REST draft-order lookup and order-level subtotal source. Add a local pricing calculation in the email formatter that mirrors the existing customer dashboard behavior:

- Start with the line item's base `price`, falling back to the variant price.
- For `FIXED_AMOUNT`, subtract the discount value and clamp at zero.
- For `PERCENTAGE`, apply the percentage discount.
- Without a supported discount, retain the current line-price fallback behavior.
- Use the resulting unit price for both HTML and plain-text line totals.

This preserves email recipients, templates, sender configuration, failure propagation, and order creation. The legacy theme fallback is outside this fix because the reported draft's stored order totals already match the reference image.

## Testing

Extend `src/app.service.shipping-quote.spec.ts` with a regression case for a quantity-one line priced at `499.99` with a fixed `472.00` discount. The test must assert that both customer and internal email bodies contain `27.99 USD each` and `27.99 USD total`, and do not render `499.99 USD each`.

Run the focused shipping-quote spec, the full backend Jest suite, and the NestJS build.
