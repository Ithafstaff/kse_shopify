import { createHmac } from 'node:crypto';

const secret = 'linendipity-test-secret';
const nowSeconds = 1_800_000_000;

function signedQuery(overrides: Record<string, string> = {}) {
  const query: Record<string, string> = {
    logged_in_customer_id: '123',
    path_prefix: '/apps/linendipity-addresses',
    shop: 'hfbaf2-f9.myshopify.com',
    timestamp: String(nowSeconds),
    ...overrides,
  };
  const message = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('');
  query.signature = createHmac('sha256', secret).update(message).digest('hex');
  return query;
}

describe('AppProxyAuthService', () => {
  function createService() {
    const { AppProxyAuthService } = require('./app-proxy-auth.service');
    const admin = { request: jest.fn() };
    const shopifyService = { adminFor: jest.fn().mockResolvedValue(admin) };
    const configService = {
      get(key: string) {
        return {
          SHOPIFY_API_SECRET: secret,
          SHOPIFY_SHOP: 'hfbaf2-f9.myshopify.com',
        }[key];
      },
    };
    return {
      admin,
      shopifyService,
      service: new AppProxyAuthService(configService, shopifyService),
    };
  }

  it('derives the customer and Admin client from a valid signed proxy request', async () => {
    const { admin, shopifyService, service } = createService();

    await expect(
      service.authenticate(signedQuery(), nowSeconds),
    ).resolves.toEqual({
      shop: 'hfbaf2-f9.myshopify.com',
      customerId: '123',
      admin,
    });
    expect(shopifyService.adminFor).toHaveBeenCalledWith(
      'hfbaf2-f9.myshopify.com',
    );
  });

  it.each([
    ['missing signature', { signature: undefined }],
    ['wrong shop', { shop: 'attacker.myshopify.com' }],
    ['guest customer', { logged_in_customer_id: '' }],
    ['nonnumeric customer', { logged_in_customer_id: 'gid://Customer/123' }],
    ['stale timestamp', { timestamp: String(nowSeconds - 301) }],
    ['future timestamp', { timestamp: String(nowSeconds + 301) }],
  ])('rejects %s', async (_label, change) => {
    const { service } = createService();
    const query = signedQuery();
    Object.assign(query, change);

    await expect(service.authenticate(query, nowSeconds)).rejects.toMatchObject({
      status: 401,
      code: 'APP_PROXY_UNAUTHORIZED',
    });
  });

  it('rejects a malformed hexadecimal signature without throwing crypto errors', async () => {
    const { service } = createService();
    const query = signedQuery();
    query.signature = 'not-hexadecimal';

    await expect(service.authenticate(query, nowSeconds)).rejects.toMatchObject({
      status: 401,
      code: 'APP_PROXY_UNAUTHORIZED',
    });
  });
});
