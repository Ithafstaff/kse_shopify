import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';

jest.mock('axios');

const mockedAxios = axios as jest.MockedFunction<typeof axios>;

describe('AppService My Orders pagination', () => {
  let service: AppService;

  beforeEach(() => {
    mockedAxios.mockReset();

    const configService = {
      get: jest.fn((key: string) => {
        const values = {
          SHOPIFY_API_URL: 'https://shopify.example/graphql.json',
          SHOPIFY_ACCESS_TOKEN: 'test-token',
          SHOPIFY_REST_API_URL_2: 'https://shopify.example',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new AppService(configService);
  });

  const createResponse = (pageInfo) => ({
    data: {
      data: {
        draftOrders: {
          edges: [],
          pageInfo,
        },
      },
    },
  });

  it('requests only the first 10 matching customer orders', async () => {
    mockedAxios.mockResolvedValueOnce(
      createResponse({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: 'start-1',
        endCursor: 'end-1',
      }),
    );

    const result = await service.getMyOrdersPage(
      'gid://shopify/Customer/12345',
    );
    const request = mockedAxios.mock.calls[0][0] as any;

    expect(request.data.variables).toEqual({
      first: 10,
      after: null,
      last: null,
      before: null,
      searchQuery: 'customer_id:12345 tag:Placed',
    });
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it('uses the end cursor to request the next 10 orders', async () => {
    mockedAxios.mockResolvedValueOnce(
      createResponse({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: 'start-2',
        endCursor: 'end-2',
      }),
    );

    await service.getMyOrdersPage(
      'gid://shopify/Customer/12345',
      'end-1',
    );
    const request = mockedAxios.mock.calls[0][0] as any;

    expect(request.data.variables).toEqual({
      first: 10,
      after: 'end-1',
      last: null,
      before: null,
      searchQuery: 'customer_id:12345 tag:Placed',
    });
  });

  it('uses the start cursor to request the previous 10 orders', async () => {
    mockedAxios.mockResolvedValueOnce(
      createResponse({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: 'start-1',
        endCursor: 'end-1',
      }),
    );

    await service.getMyOrdersPage(
      'gid://shopify/Customer/12345',
      undefined,
      'start-2',
    );
    const request = mockedAxios.mock.calls[0][0] as any;

    expect(request.data.variables).toEqual({
      first: null,
      after: null,
      last: 10,
      before: 'start-2',
      searchQuery: 'customer_id:12345 tag:Placed',
    });
  });
});
