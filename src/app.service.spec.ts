import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';

jest.mock('axios');

const mockedAxios = axios as jest.MockedFunction<typeof axios>;

function axiosRequest(index: number) {
  return mockedAxios.mock.calls[index][0] as unknown as {
    data: { query: string; variables: Record<string, unknown> };
  };
}

function configService(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      const values = {
        SHOPIFY_API_URL: 'https://shop.example/admin/api/graphql.json',
        SHOPIFY_ACCESS_TOKEN: 'test-token',
        SHOPIFY_REST_API_URL_2: 'https://shop.example',
      };
      return values[key];
    }),
  } as unknown as ConfigService;
}

function orderEdge(
  id: string,
  cursor: string,
  tags: string[],
  shippingPrice = '0.00',
) {
  return {
    cursor,
    node: {
      id: `gid://shopify/DraftOrder/${id}`,
      name: `#D${id}`,
      createdAt: '2026-07-01T00:00:00Z',
      customer: { id: 'gid://shopify/Customer/1' },
      tags,
      shippingAddress: null,
      shippingLine: { title: 'Shipping', price: shippingPrice },
      lineItems: { edges: [] },
    },
  };
}

function shopifyPage(
  edges: ReturnType<typeof orderEdge>[],
  hasNextPage = false,
  count?: number,
) {
  return {
    data: {
      data: {
        ...(count === undefined ? {} : { draftOrdersCount: { count } }),
        draftOrders: {
          edges,
          pageInfo: {
            hasNextPage,
            endCursor: edges.at(-1)?.cursor ?? null,
          },
        },
      },
    },
  };
}

function customerEdge(id: string, cursor: string) {
  return {
    cursor,
    node: {
      id: `gid://shopify/Customer/${id}`,
      firstName: `First${id}`,
      lastName: `Last${id}`,
      email: `customer${id}@example.com`,
      addresses: [],
      defaultAddress: {
        address1: null,
        company: id === '2' ? 'Acme' : null,
        city: null,
        province: null,
        country: null,
        zip: null,
      },
      tags: ['price1'],
    },
  };
}

describe('AppService draft order address persistence', () => {
  let service: AppService;
  const mockedAxiosPost = jest.mocked(axios.post);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppService(configService());
  });

  it('sends recipient names with the shipping address update', async () => {
    mockedAxiosPost.mockResolvedValueOnce({
      data: {
        data: {
          draftOrderUpdate: {
            draftOrder: { id: 'gid://shopify/DraftOrder/1001' },
            userErrors: [],
          },
        },
      },
    });

    await service.updateDraftOrderAddress(
      'gid://shopify/DraftOrder/1001',
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        company: 'Analytical Engine',
        address1: '123 Main Street',
        city: 'New York',
        province: 'NY',
        country: 'United States',
        zip: '10001',
      },
      'ada@example.com',
    );

    const request = mockedAxiosPost.mock.calls[0][1] as { query: string };
    expect(request.query).toContain('firstName: "Ada"');
    expect(request.query).toContain('lastName: "Lovelace"');
  });
});

describe('AppService order pagination', () => {
  let service: AppService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppService(configService());
  });

  describe('getCompanyDraftOrdersPage', () => {
    it('preserves normalized and partial historical company matching', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', [
            'Placed',
            'company: ACME Medical Supplies, Inc.',
          ]),
          orderEdge('2', 'cursor-2', ['Placed', 'company: Other Company']),
          orderEdge('3', 'cursor-3', [
            'Placed',
            'company: Acme-Medical-Supplies',
          ]),
        ]),
      );

      const result = await service.getCompanyDraftOrdersPage(
        'Acme Medical Supplies',
        10,
      );

      expect(result.orders.map((order) => order.id)).toEqual([
        'gid://shopify/DraftOrder/1',
        'gid://shopify/DraftOrder/3',
      ]);
      expect(result.pageInfo).toEqual({
        hasNextPage: false,
        endCursor: null,
      });
    });

    it('filters company orders by numeric PO across scanned orders', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', [
            'Placed',
            'company: Acme',
            'PO:TEST',
          ]),
          orderEdge('2', 'cursor-2', [
            'Placed',
            'company: Acme',
            'PO:123456',
          ]),
          orderEdge('3', 'cursor-3', [
            'Placed',
            'company: Other',
            'PO:123456',
          ]),
        ]),
      );

      const result = await service.getCompanyDraftOrdersPage(
        'Acme',
        10,
        undefined,
        '123456',
      );

      expect(result.orders.map((order) => order.name)).toEqual(['#D2']);
    });

    it('filters company orders by mixed symbol PO without stripping punctuation', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', [
            'Placed',
            'company: Acme',
            'PO:BLS#3170',
          ]),
          orderEdge('2', 'cursor-2', [
            'Placed',
            'company: Acme',
            'PO:BLS3170',
          ]),
        ]),
      );

      const result = await service.getCompanyDraftOrdersPage(
        'Acme',
        10,
        undefined,
        'BLS#3170',
      );

      expect(result.orders.map((order) => order.name)).toEqual(['#D1']);
    });

    it('filters company orders by word PO case-insensitively', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', [
            'Placed',
            'company: Acme',
            'PO:TEST',
          ]),
          orderEdge('2', 'cursor-2', [
            'Placed',
            'company: Acme',
            'PO:OTHER',
          ]),
        ]),
      );

      const result = await service.getCompanyDraftOrdersPage(
        'Acme',
        10,
        undefined,
        'test',
      );

      expect(result.orders.map((order) => order.name)).toEqual(['#D1']);
    });

    it('resumes after the last consumed edge without duplicates', async () => {
      mockedAxios
        .mockResolvedValueOnce(
          shopifyPage(
            [
              orderEdge('1', 'cursor-1', ['Placed', 'company: Acme']),
              orderEdge('2', 'cursor-2', ['Placed', 'company: Acme']),
              orderEdge('3', 'cursor-3', ['Placed', 'company: Acme']),
            ],
            true,
          ),
        )
        .mockResolvedValueOnce(
          shopifyPage([
            orderEdge('3', 'cursor-3', ['Placed', 'company: Acme']),
          ]),
        );

      const firstPage = await service.getCompanyDraftOrdersPage('Acme', 2);
      const secondPage = await service.getCompanyDraftOrdersPage(
        'Acme',
        2,
        firstPage.pageInfo.endCursor,
      );

      expect(firstPage.orders.map((order) => order.name)).toEqual([
        '#D1',
        '#D2',
      ]);
      expect(secondPage.orders.map((order) => order.name)).toEqual(['#D3']);
      expect(axiosRequest(1).data.variables.after).toBe('cursor-2');
    });

    it('scans multiple Shopify pages until it fills the requested page', async () => {
      mockedAxios
        .mockResolvedValueOnce(
          shopifyPage(
            [orderEdge('1', 'cursor-1', ['Placed', 'company: Other'])],
            true,
          ),
        )
        .mockResolvedValueOnce(
          shopifyPage(
            [orderEdge('2', 'cursor-2', ['Placed', 'company: Acme'])],
            true,
          ),
        )
        .mockResolvedValueOnce(
          shopifyPage([
            orderEdge('3', 'cursor-3', ['Placed', 'company: Acme']),
          ]),
        );

      const result = await service.getCompanyDraftOrdersPage('Acme', 2);

      expect(result.orders.map((order) => order.name)).toEqual([
        '#D2',
        '#D3',
      ]);
      expect(mockedAxios).toHaveBeenCalledTimes(3);
    });

    it('returns a terminal empty page when no company orders match', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', ['Placed', 'company: Other']),
        ]),
      );

      await expect(
        service.getCompanyDraftOrdersPage('Acme', 10),
      ).resolves.toEqual({
        orders: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    });

    it('does not match draft orders with blank company tags', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', ['Placed', 'company:']),
          orderEdge('2', 'cursor-2', ['Placed', 'company:   ']),
        ]),
      );

      await expect(
        service.getCompanyDraftOrdersPage('Acme', 10),
      ).resolves.toEqual({
        orders: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    });

    it.each([
      ['', undefined],
      ['Acme', 'not-base64-json'],
      [
        'Acme',
        Buffer.from(JSON.stringify({ version: 2, lastConsumedEdgeCursor: null }))
          .toString('base64url'),
      ],
    ])('rejects invalid company or cursor input', async (company, cursor) => {
      await expect(
        service.getCompanyDraftOrdersPage(company, 10, cursor),
      ).rejects.toThrow();
    });

    it('rejects company names that normalize to an empty value', async () => {
      await expect(
        service.getCompanyDraftOrdersPage('---', 10),
      ).rejects.toThrow('Company is required.');
      expect(mockedAxios).not.toHaveBeenCalled();
    });

    it('surfaces Shopify GraphQL failures', async () => {
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mockedAxios.mockResolvedValueOnce({
        data: { errors: [{ message: 'Throttled' }] },
      });

      await expect(
        service.getCompanyDraftOrdersPage('Acme', 10),
      ).rejects.toThrow('Failed to fetch company draft-order page.');
      expect(consoleError).toHaveBeenCalledWith(
        'Error fetching company draft-order page:',
        'Throttled',
      );
      consoleError.mockRestore();
    });
  });

  describe('getCombinedDraftOrdersPage', () => {
    it('returns personal and company orders in one newest-first page', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', [
            'Placed',
            'company: Other',
            'PO:111',
          ]),
          orderEdge('2', 'cursor-2', [
            'Placed',
            'company: Acme',
            'PO:222',
          ]),
          orderEdge('3', 'cursor-3', [
            'Placed',
            'company: Other',
            'PO:333',
          ]),
        ]),
      );

      const result = await service.getCombinedDraftOrdersPage(
        'gid://shopify/Customer/1',
        'Acme',
        10,
      );

      expect(result.orders.map((order) => order.name)).toEqual([
        '#D1',
        '#D2',
        '#D3',
      ]);
      expect(axiosRequest(0).data).toMatchObject({
        variables: {
          first: 50,
          searchQuery: 'tag:Placed',
        },
      });
      expect(axiosRequest(0).data.query).toContain('sortKey: NUMBER');
    });

    it('filters combined orders by PO across personal and company matches', async () => {
      mockedAxios.mockResolvedValueOnce(
        shopifyPage([
          orderEdge('1', 'cursor-1', [
            'Placed',
            'company: Other',
            'PO:ABC-123',
          ]),
          orderEdge('2', 'cursor-2', [
            'Placed',
            'company: Acme',
            'PO:ABC-123',
          ]),
          orderEdge('3', 'cursor-3', [
            'Placed',
            'company: Acme',
            'PO:XYZ-999',
          ]),
        ]),
      );

      const result = await service.getCombinedDraftOrdersPage(
        'gid://shopify/Customer/1',
        'Acme',
        10,
        undefined,
        'abc-123',
      );

      expect(result.orders.map((order) => order.name)).toEqual([
        '#D1',
        '#D2',
      ]);
    });

    it('resumes combined pagination after the last consumed Shopify edge', async () => {
      mockedAxios
        .mockResolvedValueOnce(
          shopifyPage(
            [
              orderEdge('1', 'cursor-1', ['Placed', 'company: Other']),
              orderEdge('2', 'cursor-2', ['Placed', 'company: Acme']),
              orderEdge('3', 'cursor-3', ['Placed', 'company: Acme']),
            ],
            true,
          ),
        )
        .mockResolvedValueOnce(
          shopifyPage([orderEdge('3', 'cursor-3', ['Placed', 'company: Acme'])]),
        );

      const firstPage = await service.getCombinedDraftOrdersPage(
        'gid://shopify/Customer/1',
        'Acme',
        2,
      );
      const secondPage = await service.getCombinedDraftOrdersPage(
        'gid://shopify/Customer/1',
        'Acme',
        2,
        firstPage.pageInfo.endCursor,
      );

      expect(firstPage.orders.map((order) => order.name)).toEqual([
        '#D1',
        '#D2',
      ]);
      expect(secondPage.orders.map((order) => order.name)).toEqual(['#D3']);
      expect(axiosRequest(1).data.variables.after).toBe('cursor-2');
    });
  });

  it('keeps My Orders server-side filtering and caps pages at ten', async () => {
    mockedAxios.mockResolvedValueOnce(shopifyPage([]));

    const result = await service.getDraftOrdersPageByCustomerId(
      'gid://shopify/Customer/123',
      50,
    );

    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(axiosRequest(0).data.variables).toMatchObject({
      first: 10,
      searchQuery: 'customer_id:123 tag:Placed',
    });
  });

  it('keeps Draft Orders server-side filtering and caps pages at ten', async () => {
    mockedAxios.mockResolvedValueOnce(shopifyPage([]));

    const result = await service.getSavedDraftOrdersPageByCustomerId(
      'gid://shopify/Customer/123',
      50,
    );

    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(axiosRequest(0).data.variables).toMatchObject({
      first: 10,
      searchQuery: 'customer_id:123 -tag:Placed -tag:ShipRequested',
    });
  });

  it('keeps Requested Shipping server-side filtered, paginated, and includes shipping data', async () => {
    mockedAxios.mockResolvedValueOnce(
      shopifyPage(
        [orderEdge('9', 'cursor-9', ['ShipRequested'], '12.50')],
        false,
        1,
      ),
    );

    const result = await service.getRequestedShippingDraftOrdersPageByCustomerId(
      'gid://shopify/Customer/123',
      50,
    );

    expect(result.orders).toMatchObject([
      {
        id: 'gid://shopify/DraftOrder/9',
        tags: ['ShipRequested'],
        shippingLine: { title: 'Shipping', price: 12.5 },
      },
    ]);
    expect(result.pageInfo.totalCount).toBe(1);
    expect(axiosRequest(0).data.variables).toMatchObject({
      first: 10,
      searchQuery: 'customer_id:123 tag:ShipRequested -tag:Placed',
    });
    expect(axiosRequest(0).data.query).toContain('sortKey: NUMBER');
    expect(axiosRequest(0).data.query).toContain('reverse: true');
    expect(axiosRequest(0).data.query).toContain('shippingLine {');
  });

  it('requests all draft orders with Shopify-supported oldest-first ordering', async () => {
    mockedAxios.mockResolvedValueOnce(shopifyPage([]));

    await service.getDraftOrders();

    expect(axiosRequest(0).data.query).toContain('sortKey: NUMBER');
    expect(axiosRequest(0).data.query).toContain('reverse: false');
    expect(axiosRequest(0).data.query).not.toContain('sortKey: CREATED_AT');
  });
});

describe('AppService customer pagination', () => {
  let service: AppService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppService(configService());
  });

  it('searches customers with Shopify query and cursor pagination', async () => {
    mockedAxios.mockResolvedValueOnce({
      data: {
        data: {
          customers: {
            edges: [customerEdge('1', 'cursor-1'), customerEdge('2', 'cursor-2')],
            pageInfo: {
              hasNextPage: true,
              endCursor: 'cursor-2',
            },
          },
        },
      },
    });

    const result = await service.searchCustomers('Ada Lovelace', 2, 'cursor-0');

    expect(result.customers.map((customer) => customer.id)).toEqual([
      'gid://shopify/Customer/1',
      'gid://shopify/Customer/2',
    ]);
    expect(result.pageInfo).toEqual({
      hasNextPage: true,
      endCursor: 'cursor-2',
    });

    const request = mockedAxios.mock.calls[0][0] as unknown as {
      data: { variables: Record<string, unknown>; query: string };
    };
    expect(request.data.variables).toEqual({
      first: 2,
      after: 'cursor-0',
      query: 'Ada Lovelace',
    });
    expect(request.data.query).toContain(
      'customers(first: $first, after: $after, query: $query)',
    );
  });
});

describe('AppService shipping address validation', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService(configService());
  });

  it.each([
    ['firstName'],
    ['lastName'],
    ['address1'],
    ['city'],
    ['province'],
    ['country'],
    ['zip'],
  ])('rejects a blank %s', (field) => {
    const address = {
      firstName: 'Jane',
      lastName: 'Doe',
      address1: '123 Main Street',
      address2: '',
      city: 'Manila',
      province: 'Metro Manila',
      country: 'Philippines',
      zip: '1000',
      [field]: '   ',
    };

    expect(() => service.validateShippingAddress(address)).toThrow(
      'All required shipping address fields must be provided.',
    );
  });

  it('allows optional address fields to be blank', () => {
    expect(() =>
      service.validateShippingAddress({
        firstName: 'Jane',
        lastName: 'Doe',
        address1: '123 Main Street',
        address2: '',
        company: '   ',
        city: 'Manila',
        province: 'Metro Manila',
        country: 'Philippines',
        zip: '1000',
      }),
    ).not.toThrow();
  });
});
