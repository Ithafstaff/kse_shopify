describe('draft-order creation', () => {
  function load() {
    return require('./draft-order.service');
  }

  it('normalizes variants, quantities, and bounded line properties without prices', () => {
    const { normalizeDraftRequest } = load();

    expect(
      normalizeDraftRequest({
        idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        items: [
          {
            variantId: '123',
            quantity: 2,
            properties: [
              { key: 'Color', value: 'White' },
              { key: '_private', value: 'retained' },
            ],
          },
        ],
      }),
    ).toEqual({
      idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
      items: [
        {
          variantId: 'gid://shopify/ProductVariant/123',
          quantity: 2,
          properties: [
            { key: 'Color', value: 'White' },
            { key: '_private', value: 'retained' },
          ],
        },
      ],
    });
  });

  it.each([
    [{ idempotencyKey: 'bad', items: [] }, 'INVALID_DRAFT_REQUEST'],
    [
      {
        idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        items: [{ variantId: '123', quantity: 1, price: 10 }],
      },
      'CLIENT_PRICE_REJECTED',
    ],
    [
      {
        idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        items: [{ variantId: 'bad-id', quantity: 1 }],
      },
      'INVALID_DRAFT_REQUEST',
    ],
    [
      {
        idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        items: [{ variantId: '123', quantity: 1001 }],
      },
      'INVALID_DRAFT_REQUEST',
    ],
  ])('rejects unsafe draft input %#', (input, code) => {
    const { normalizeDraftRequest } = load();
    expect(() => normalizeDraftRequest(input)).toThrow(
      expect.objectContaining({ status: 422, code }),
    );
  });

  it('creates a tagged draft from the signed customer and Shopify address', async () => {
    const { DraftOrderService, normalizeDraftRequest } = load();
    const attempts = {
      claim: jest.fn().mockResolvedValue({ kind: 'claimed' }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const admin = {
      request: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            customer: {
              id: 'gid://shopify/Customer/123',
              defaultAddress: {
                firstName: 'Ada',
                lastName: 'Lovelace',
                company: 'Analytical Engine',
                address1: '1 Main St',
                address2: '',
                city: 'Chicago',
                provinceCode: 'IL',
                countryCodeV2: 'US',
                zip: '60601',
                phone: '+13125550100',
              },
            },
          },
        })
        .mockResolvedValueOnce({ data: { draftOrders: { nodes: [] } } })
        .mockResolvedValueOnce({
          data: {
            draftOrderCreate: {
              draftOrder: { id: 'gid://shopify/DraftOrder/99', name: '#D99' },
              userErrors: [],
            },
          },
        }),
    };
    const service = new DraftOrderService(attempts);
    const request = normalizeDraftRequest({
      idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
      items: [
        {
          variantId: '123',
          quantity: 2,
          properties: [{ key: 'Color', value: 'White' }],
        },
      ],
    });

    await expect(
      service.createDraft(
        { shop: 'hfbaf2-f9.myshopify.com', customerId: '123', admin },
        request,
      ),
    ).resolves.toEqual({ id: 'gid://shopify/DraftOrder/99', name: '#D99' });

    const mutationOptions = admin.request.mock.calls[2][1];
    expect(mutationOptions.variables.input).toEqual(
      expect.objectContaining({
        customerId: 'gid://shopify/Customer/123',
        lineItems: [
          {
            variantId: 'gid://shopify/ProductVariant/123',
            quantity: 2,
            customAttributes: [{ key: 'Color', value: 'White' }],
          },
        ],
        shippingAddress: expect.objectContaining({
          firstName: 'Ada',
          lastName: 'Lovelace',
          address1: '1 Main St',
          city: 'Chicago',
          province: 'IL',
          country: 'US',
          zip: '60601',
        }),
        tags: expect.arrayContaining(['LinendipityDraft']),
      }),
    );
    expect(JSON.stringify(mutationOptions.variables)).not.toMatch(
      /price|subtotal|total/i,
    );
    expect(attempts.complete).toHaveBeenCalledWith(
      'hfbaf2-f9.myshopify.com',
      '123',
      '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
      { id: 'gid://shopify/DraftOrder/99', name: '#D99' },
    );
  });

  it('does not create a draft when Shopify has no usable default address', async () => {
    const { DraftOrderService, normalizeDraftRequest } = load();
    const attempts = {
      claim: jest.fn().mockResolvedValue({ kind: 'claimed' }),
      complete: jest.fn(),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const admin = {
      request: jest.fn().mockResolvedValueOnce({
        data: {
          customer: {
            id: 'gid://shopify/Customer/123',
            defaultAddress: null,
          },
        },
      }),
    };
    const service = new DraftOrderService(attempts);
    const request = normalizeDraftRequest({
      idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
      items: [{ variantId: '123', quantity: 1 }],
    });

    await expect(
      service.createDraft(
        { shop: 'hfbaf2-f9.myshopify.com', customerId: '123', admin },
        request,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'DEFAULT_ADDRESS_REQUIRED' });
    expect(admin.request).toHaveBeenCalledTimes(1);
  });

  it('replays the stored result without calling Shopify', async () => {
    const { DraftOrderService, normalizeDraftRequest } = load();
    const attempts = {
      claim: jest.fn().mockResolvedValue({
        kind: 'replay',
        draft: { id: 'gid://shopify/DraftOrder/99', name: '#D99' },
      }),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const admin = { request: jest.fn() };
    const service = new DraftOrderService(attempts);

    await expect(
      service.createDraft(
        { shop: 'hfbaf2-f9.myshopify.com', customerId: '123', admin },
        normalizeDraftRequest({
          idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
          items: [{ variantId: '123', quantity: 1 }],
        }),
      ),
    ).resolves.toEqual({ id: 'gid://shopify/DraftOrder/99', name: '#D99' });
    expect(admin.request).not.toHaveBeenCalled();
  });

  it('returns a safe conflict when a key is reused for different cart contents', async () => {
    const { DraftOrderService, normalizeDraftRequest } = load();
    const { DraftAttemptConflictError } = require('./draft-attempt.repository');
    const attempts = {
      claim: jest.fn().mockRejectedValue(new DraftAttemptConflictError()),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const admin = { request: jest.fn() };
    const service = new DraftOrderService(attempts);

    await expect(
      service.createDraft(
        { shop: 'hfbaf2-f9.myshopify.com', customerId: '123', admin },
        normalizeDraftRequest({
          idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
          items: [{ variantId: '123', quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect(admin.request).not.toHaveBeenCalled();
    expect(attempts.fail).not.toHaveBeenCalled();
  });

  it('recovers a Shopify draft created before the database attempt completed', async () => {
    const { DraftOrderService, normalizeDraftRequest } = load();
    const attempts = {
      claim: jest.fn().mockResolvedValue({ kind: 'in_progress' }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn(),
    };
    const admin = {
      request: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            customer: {
              id: 'gid://shopify/Customer/123',
              defaultAddress: {
                firstName: 'Ada',
                lastName: 'Lovelace',
                address1: '1 Main St',
                city: 'Chicago',
                provinceCode: 'IL',
                countryCodeV2: 'US',
                zip: '60601',
              },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            draftOrders: {
              nodes: [
                {
                  id: 'gid://shopify/DraftOrder/99',
                  name: '#D99',
                  customer: { id: 'gid://shopify/Customer/123' },
                },
              ],
            },
          },
        }),
    };
    const service = new DraftOrderService(attempts);
    const request = normalizeDraftRequest({
      idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
      items: [{ variantId: '123', quantity: 1 }],
    });

    await expect(
      service.createDraft(
        { shop: 'hfbaf2-f9.myshopify.com', customerId: '123', admin },
        request,
      ),
    ).resolves.toEqual({ id: 'gid://shopify/DraftOrder/99', name: '#D99' });
    expect(admin.request).toHaveBeenCalledTimes(2);
    expect(attempts.complete).toHaveBeenCalledWith(
      'hfbaf2-f9.myshopify.com',
      '123',
      request.idempotencyKey,
      { id: 'gid://shopify/DraftOrder/99', name: '#D99' },
    );
  });

  it('surfaces Shopify mutation user errors and records the failed attempt', async () => {
    const { DraftOrderService, normalizeDraftRequest } = load();
    const attempts = {
      claim: jest.fn().mockResolvedValue({ kind: 'claimed' }),
      complete: jest.fn(),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const admin = {
      request: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            customer: {
              id: 'gid://shopify/Customer/123',
              defaultAddress: {
                firstName: 'Ada',
                lastName: 'Lovelace',
                address1: '1 Main St',
                city: 'Chicago',
                provinceCode: 'IL',
                countryCodeV2: 'US',
                zip: '60601',
              },
            },
          },
        })
        .mockResolvedValueOnce({ data: { draftOrders: { nodes: [] } } })
        .mockResolvedValueOnce({
          data: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [{ field: ['lineItems'], message: 'Unavailable' }],
            },
          },
        }),
    };
    const service = new DraftOrderService(attempts);
    const request = normalizeDraftRequest({
      idempotencyKey: '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
      items: [{ variantId: '123', quantity: 1 }],
    });

    await expect(
      service.createDraft(
        { shop: 'hfbaf2-f9.myshopify.com', customerId: '123', admin },
        request,
      ),
    ).rejects.toMatchObject({ status: 502, code: 'SHOPIFY_DRAFT_FAILED' });
    expect(attempts.complete).not.toHaveBeenCalled();
    expect(attempts.fail).toHaveBeenCalledWith(
      'hfbaf2-f9.myshopify.com',
      '123',
      request.idempotencyKey,
      'SHOPIFY_DRAFT_FAILED',
    );
  });
});
