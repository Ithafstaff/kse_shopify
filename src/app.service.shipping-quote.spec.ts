import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AppService } from './app.service';
import { ShippingAddressInput } from './dto/shipping-address.input';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('AppService shipping quote emails', () => {
  const sendMail = jest.fn();
  const shippingAddress: ShippingAddressInput = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: 'Analytical <Engine>',
    address1: '123 Main & First',
    city: 'New York',
    province: 'NY',
    country: 'US',
    zip: '10001',
  };
  let service: AppService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMail.mockResolvedValue({ messageId: 'message-id' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    const configService = {
      get: jest.fn((key: string) => {
        const values = {
          EMAIL_USER: 'mailer@ksesuppliers.com',
          EMAIL_PASS: 'secret',
          SHOPIFY_API_URL: 'https://shopify.example/graphql',
          SHOPIFY_ACCESS_TOKEN: 'token',
          SHOPIFY_REST_API_URL_2: 'https://shopify.example',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new AppService(configService);
    jest.spyOn(service, 'getDraftOrderDetails').mockResolvedValue({
      id: 1001,
      name: '#D1001',
      currency: 'USD',
      subtotal_price: '42.50',
      total_price: '42.50',
      tags: 'PO: PO-77, ShipRequested',
      customer: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'customer@example.com',
      },
      line_items: [
        {
          title: 'Blue <Widget>',
          quantity: 2,
          price: '10.00',
          line_price: '20.00',
        },
        {
          title: 'Red Widget',
          quantity: 1,
          price: '22.50',
          line_price: '22.50',
        },
      ],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a templated receipt to the customer', async () => {
    await (service as any).sendShippingQuoteEmails(
      'customer-123',
      'gid://shopify/DraftOrder/1001',
      'customer@example.com',
      shippingAddress,
    );

    const customerMessage = sendMail.mock.calls[0][0];
    expect(customerMessage).toEqual(
      expect.objectContaining({
        from: 'mailer@ksesuppliers.com',
        to: 'customer@example.com',
        subject: 'Shipping Quote Request Received - Order #D1001',
      }),
    );
    expect(customerMessage.html).toContain('Shipping Quote Request Received');
    expect(customerMessage.html).toContain('#D1001');
    expect(customerMessage.html).toContain('123 Main &amp; First');
    expect(customerMessage.html).toContain('Blue &lt;Widget&gt;');
    expect(customerMessage.html).toContain('x2');
    expect(customerMessage.html).toContain('42.50 USD');
    expect(customerMessage.html).toContain(
      'No payment or further action is required until the shipping quote has been prepared.',
    );
  });

  it('sends a templated operational email to orders', async () => {
    await (service as any).sendShippingQuoteEmails(
      'customer-123',
      'gid://shopify/DraftOrder/1001',
      'customer@example.com',
      shippingAddress,
    );

    const internalMessage = sendMail.mock.calls[1][0];
    expect(internalMessage).toEqual(
      expect.objectContaining({
        from: 'mailer@ksesuppliers.com',
        to: 'orders@ksesuppliers.com',
        subject: 'Shipping Quote Request - Order #D1001',
      }),
    );
    expect(internalMessage.html).toContain('customer-123');
    expect(internalMessage.html).toContain('Ada Lovelace');
    expect(internalMessage.html).toContain('customer@example.com');
    expect(internalMessage.html).toContain('Analytical &lt;Engine&gt;');
    expect(internalMessage.html).toContain('PO-77');
    expect(internalMessage.html).toContain('10.00 USD each');
    expect(internalMessage.html).toContain('42.50 USD');
    expect(internalMessage.html).toContain(
      'https://admin.shopify.com/store/kse-suppliers/draft_orders/1001',
    );
  });

  it('escapes customer-controlled values in both messages', async () => {
    await (service as any).sendShippingQuoteEmails(
      'customer-123',
      'gid://shopify/DraftOrder/1001',
      'customer@example.com',
      shippingAddress,
    );

    for (const [{ html }] of sendMail.mock.calls) {
      expect(html).not.toContain('Analytical <Engine>');
      expect(html).not.toContain('Blue <Widget>');
      expect(html).not.toContain('123 Main & First');
    }
  });

  it('rejects when either email cannot be sent', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(
      (service as any).sendShippingQuoteEmails(
        'customer-123',
        'gid://shopify/DraftOrder/1001',
        'customer@example.com',
        shippingAddress,
      ),
    ).rejects.toThrow('Failed to send shipping quote emails.');
  });
});

