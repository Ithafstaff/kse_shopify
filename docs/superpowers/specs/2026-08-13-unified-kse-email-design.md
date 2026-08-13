# Unified KSE Transactional Email Design

**Date:** 2026-08-13

**Status:** Approved for implementation

## Goal

Give the account-request and shipping-quote workflows one consistent KSE-branded HTML email presentation while keeping the existing recipients, delivery behavior, plain-text alternatives, and internal tracking behavior.

## Scope

The shared presentation applies to the four HTML messages sent by these workflows:

1. Account-request internal notification.
2. Account-request customer acknowledgment.
3. Shipping-quote internal notification.
4. Shipping-quote customer acknowledgment.

The customer-facing account-request email will no longer display the generated request ID. The internal notification, backend logs, and existing GraphQL result will retain it for troubleshooting and correlation.

## Visual direction

Each HTML email will use a shared email-safe layout:

- A light neutral outer background.
- A centered white content card with a maximum width suitable for desktop and mobile email clients.
- A KSE maroon brand/header treatment.
- Consistent left-aligned typography, heading hierarchy, padding, borders, and footer treatment.
- Inline CSS and presentation tables for broad email-client compatibility.
- No external logo dependency or change to the Google autocomplete attribution.

Account-request details will use the shared label/value treatment. Shipping-quote messages will retain their existing address and order content while improving section spacing, item-table headers, numeric alignment, subtotal emphasis, and the internal draft-order action link.

## Subject and content rules

- Internal account-request subject: `New Website Account Request - [Business] - [Request ID]`.
- Customer account-request subject: `We Received Your KSE Account Request`.
- Shipping-quote customer subject remains `Shipping Quote Request Received - Order [Order Number]`.
- Shipping-quote internal subject remains `Shipping Quote Request - Order [Order Number]`.
- The customer account-request plain-text and HTML bodies omit `Request ID`.
- Internal account-request plain-text and HTML bodies retain `Request ID`.

## Behavior constraints

This change will not alter:

- Resend transport or configuration.
- Recipients, reply-to addresses, or internal/customer send order.
- Shipping-quote failure propagation.
- Account-request validation, rate limiting, or failure responses.
- HTML escaping of customer-controlled values.
- The Shopify theme or Google Places autocomplete behavior.

## Verification

Tests will cover the shared layout markers, exact subject casing, customer/internal request-ID visibility, shipping table presentation markers, escaping, and existing delivery semantics. The focused backend suites, full Jest suite, and NestJS build will run after implementation.
