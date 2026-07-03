import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';

jest.mock('axios');

const mockedAxios = axios as jest.MockedFunction<typeof axios>;

function axiosRequest(index: number) {
  return mockedAxios.mock.calls[index][0] as unknown as {
    data: { variables: Record<string, unknown> };
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
) {
  return {
    data: {
      data: {
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
