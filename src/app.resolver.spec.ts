import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { ShippingAddressInput } from './dto/shipping-address.input';

describe('AppResolver requestShippingFee', () => {
  const shippingAddress: ShippingAddressInput = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: 'Analytical Engine',
    address1: '123 Main Street',
    city: 'New York',
    province: 'NY',
    country: 'US',
    zip: '10001',
  };
  let appService: {
    updateDraftOrderAddress: jest.Mock;
    sendShippingQuoteEmails: jest.Mock;
    getDraftOrders: jest.Mock;
  };
  let resolver: AppResolver;

  beforeEach(() => {
    appService = {
      updateDraftOrderAddress: jest.fn().mockResolvedValue(true),
      sendShippingQuoteEmails: jest.fn().mockResolvedValue(true),
      getDraftOrders: jest.fn(),
    };
    resolver = new AppResolver(appService as unknown as AppService);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('updates the address before dispatching both shipping quote emails', async () => {
    await expect(
      resolver.requestShippingFee(
        'customer-123',
        'gid://shopify/DraftOrder/1001',
        'customer@example.com',
        shippingAddress,
      ),
    ).resolves.toBe(true);

    expect(appService.updateDraftOrderAddress).toHaveBeenCalledWith(
      'gid://shopify/DraftOrder/1001',
      shippingAddress,
      'customer@example.com',
    );
    expect(appService.sendShippingQuoteEmails).toHaveBeenCalledWith(
      'customer-123',
      'gid://shopify/DraftOrder/1001',
      'customer@example.com',
      shippingAddress,
    );
    expect(
      appService.updateDraftOrderAddress.mock.invocationCallOrder[0],
    ).toBeLessThan(
      appService.sendShippingQuoteEmails.mock.invocationCallOrder[0],
    );
  });

  it('does not dispatch emails when the address update fails', async () => {
    appService.updateDraftOrderAddress.mockRejectedValue(
      new Error('Address update failed'),
    );

    await expect(
      resolver.requestShippingFee(
        'customer-123',
        'gid://shopify/DraftOrder/1001',
        'customer@example.com',
        shippingAddress,
      ),
    ).rejects.toThrow('Failed to request shipping fee. Address update failed');
    expect(appService.sendShippingQuoteEmails).not.toHaveBeenCalled();
  });

  it('reports failure when email dispatch fails', async () => {
    appService.sendShippingQuoteEmails.mockRejectedValue(
      new Error('Failed to send shipping quote emails.'),
    );

    await expect(
      resolver.requestShippingFee(
        'customer-123',
        'gid://shopify/DraftOrder/1001',
        'customer@example.com',
        shippingAddress,
      ),
    ).rejects.toThrow(
      'Failed to request shipping fee. Failed to send shipping quote emails.',
    );
  });

  it('updates a normal order address without sending shipping quote emails', async () => {
    await expect(
      resolver.updateDraftOrderAddress(
        'gid://shopify/DraftOrder/1001',
        'customer@example.com',
        shippingAddress,
      ),
    ).resolves.toBe(true);

    expect(appService.updateDraftOrderAddress).toHaveBeenCalledWith(
      'gid://shopify/DraftOrder/1001',
      shippingAddress,
      'customer@example.com',
    );
    expect(appService.sendShippingQuoteEmails).not.toHaveBeenCalled();
  });

  it('preserves oldest-first order for requested shipping draft orders', async () => {
    appService.getDraftOrders.mockResolvedValue([
      {
        id: 'gid://shopify/DraftOrder/1001',
        createdAt: '2026-07-01T00:00:00Z',
        customer: { id: 'gid://shopify/Customer/123' },
        tags: ['ShipRequested'],
      },
      {
        id: 'gid://shopify/DraftOrder/1002',
        createdAt: '2026-07-03T00:00:00Z',
        customer: { id: 'gid://shopify/Customer/123' },
        tags: ['ShipRequested'],
      },
      {
        id: 'gid://shopify/DraftOrder/1003',
        createdAt: '2026-07-02T00:00:00Z',
        customer: { id: 'gid://shopify/Customer/123' },
        tags: ['Placed'],
      },
    ]);

    const orders = await resolver.getDraftOrdersByCustomerId(
      'gid://shopify/Customer/123',
      ['ShipRequested'],
    );

    expect(orders.map((order) => order.id)).toEqual([
      'gid://shopify/DraftOrder/1001',
      'gid://shopify/DraftOrder/1002',
    ]);
  });
});
