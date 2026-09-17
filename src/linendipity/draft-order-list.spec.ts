describe('draft-order listing', () => {
  function load() {
    return require('./draft-order.service');
  }

  const context = (admin: { request: jest.Mock }) => ({
    shop: 'hfbaf2-f9.myshopify.com',
    customerId: '123',
    admin,
  });

  const attempts = {
    claim: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };

  it.each([
    [{ first: '0' }, 1],
    [{ first: '50' }, 10],
    [{ first: undefined }, 10],
  ])('clamps page size %#', async (pagination, expectedFirst) => {
    const { DraftOrderService } = load();
    const admin = {
      request: jest.fn().mockResolvedValue({
        data: {
          draftOrders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          draftOrdersCount: { count: 0 },
        },
      }),
    };
    const service = new DraftOrderService(attempts);

    await service.listDrafts(context(admin), pagination);

    expect(admin.request.mock.calls[0][1].variables).toEqual(
      expect.objectContaining({ first: expectedFirst, after: null }),
    );
  });

  it.each(['not a cursor', 'a'.repeat(513)])(
    'rejects malformed cursor %p before calling Shopify',
    async (after) => {
      const { DraftOrderService } = load();
      const admin = { request: jest.fn() };
      const service = new DraftOrderService(attempts);

      await expect(
        service.listDrafts(context(admin), { first: '10', after }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_CURSOR' });
      expect(admin.request).not.toHaveBeenCalled();
    },
  );

  it('queries the signed customer and maps a safe paginated response', async () => {
    const { DraftOrderService } = load();
    const admin = {
      request: jest.fn().mockResolvedValue({
        data: {
          draftOrders: {
            nodes: [
              {
                id: 'gid://shopify/DraftOrder/99',
                name: '#D99',
                createdAt: '2026-09-17T10:00:00Z',
                status: 'OPEN',
                totalPriceSet: {
                  shopMoney: { amount: '499.99', currencyCode: 'USD' },
                },
                totalQuantityOfLineItems: 2,
                customer: { id: 'gid://shopify/Customer/123' },
                lineItems: {
                  nodes: [
                    {
                      title: 'Open Weave Thermal Blankets',
                      variantTitle: 'White',
                      quantity: 2,
                      originalUnitPriceSet: {
                        shopMoney: { amount: '249.995', currencyCode: 'USD' },
                      },
                      originalTotalSet: {
                        shopMoney: { amount: '499.99', currencyCode: 'USD' },
                      },
                      customAttributes: [
                        { key: 'Color', value: 'White' },
                        { key: '_internal', value: 'never expose' },
                      ],
                    },
                  ],
                },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'ZW5kLWN1cnNvcg==' },
          },
          draftOrdersCount: { count: 12 },
        },
      }),
    };
    const service = new DraftOrderService(attempts);

    await expect(
      service.listDrafts(context(admin), {
        first: '10',
        after: 'c3RhcnQtY3Vyc29y',
      }),
    ).resolves.toEqual({
      orders: [
        {
          id: 'gid://shopify/DraftOrder/99',
          name: '#D99',
          createdAt: '2026-09-17T10:00:00Z',
          status: 'OPEN',
          total: { amount: '499.99', currencyCode: 'USD' },
          itemCount: 2,
          lineItems: [
            {
              title: 'Open Weave Thermal Blankets',
              variantTitle: 'White',
              quantity: 2,
              unitPrice: { amount: '249.995', currencyCode: 'USD' },
              totalPrice: { amount: '499.99', currencyCode: 'USD' },
              properties: [{ key: 'Color', value: 'White' }],
            },
          ],
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: 'ZW5kLWN1cnNvcg==' },
      totalCount: 12,
    });

    const [operation, options] = admin.request.mock.calls[0];
    expect(operation).toMatch(/sortKey:\s*CREATED_AT/);
    expect(operation).toMatch(/reverse:\s*true/);
    expect(operation).toMatch(/totalPriceSet/);
    expect(operation).toMatch(/originalUnitPriceSet/);
    expect(operation).toMatch(/lineItems\(first:\s*100\)/);
    expect(options.variables).toEqual({
      first: 10,
      after: 'c3RhcnQtY3Vyc29y',
      query: 'customer_id:123 tag:LinendipityDraft',
    });
  });

  it('rejects an upstream ownership mismatch without returning draft data', async () => {
    const { DraftOrderService } = load();
    const admin = {
      request: jest.fn().mockResolvedValue({
        data: {
          draftOrders: {
            nodes: [
              {
                id: 'gid://shopify/DraftOrder/99',
                customer: { id: 'gid://shopify/Customer/456' },
                lineItems: { nodes: [] },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
          draftOrdersCount: { count: 1 },
        },
      }),
    };
    const service = new DraftOrderService(attempts);

    await expect(
      service.listDrafts(context(admin), {}),
    ).rejects.toMatchObject({ status: 403, code: 'DRAFT_OWNERSHIP_MISMATCH' });
  });
});
