import { ConfigService } from '@nestjs/config';
import { AccountRequestService } from './account-request.service';
import { ResendMailService } from '../email/resend-mail.service';

describe('AccountRequestService', () => {
  const baseInput = {
    applicantType: 'Vendor',
    businessName: 'Gerald Linen Supply',
    contactName: 'Gerald Latagan',
    phone: '8455551212',
    email: 'gerald.latagan@gmail.com',
    comments: 'Controlled account request test',
  };

  const sendMessage = jest.fn();
  let service: AccountRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMessage.mockResolvedValue({ id: 'resend-message-id' });

    const configService = {
      get: jest.fn((key: string) => {
        const values = {
          ACCOUNT_REQUEST_ENABLED: 'true',
          ACCOUNT_REQUEST_RECIPIENT: 'it@hafstaff.com',
          EMAIL_FROM: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
          EMAIL_REPLY_TO: 'cs@ksesuppliers.com',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new AccountRequestService(configService, {
      sendMessage,
    } as unknown as ResendMailService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the internal notification before the customer acknowledgment', async () => {
    const result = await service.requestAccount(baseInput);

    expect(result.success).toBe(true);
    expect(result.requestId).toMatch(/^KSE-[0-9A-F]{8}$/);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        from: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
        to: 'orders@ksesuppliers.com',
        replyTo: 'gerald.latagan@gmail.com',
      }),
    );
    expect(sendMessage.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        from: 'KSE Suppliers <orders@notifications.ksesuppliers.com>',
        to: 'gerald.latagan@gmail.com',
        replyTo: 'cs@ksesuppliers.com',
        subject: 'We Received Your KSE Account Request',
      }),
    );
    expect(sendMessage.mock.calls[0][0].subject).toMatch(
      /^New Website Account Request - Gerald Linen Supply - KSE-[0-9A-F]{8}$/,
    );

    const internalMessage = sendMessage.mock.calls[0][0];
    const customerMessage = sendMessage.mock.calls[1][0];
    expect(internalMessage.html).toContain('KSE SUPPLIERS');
    expect(internalMessage.html).toContain('New Website Account Request');
    expect(internalMessage.html).toContain('Request ID');
    expect(customerMessage.html).toContain('KSE SUPPLIERS');
    expect(customerMessage.html).toContain('We Received Your KSE Account Request');
    expect(customerMessage.html).not.toContain('Request ID');
    expect(customerMessage.text).not.toContain('Request ID');
    expect(internalMessage.subject).toContain(result.requestId);
  });

  it('routes legacy IT recipient configuration to the KSE orders inbox', async () => {
    await service.requestAccount(baseInput);

    expect(sendMessage.mock.calls[0][0].to).toBe('orders@ksesuppliers.com');
  });

  it('accepts buyer requests and normalizes whitespace', async () => {
    await service.requestAccount({
      ...baseInput,
      applicantType: ' buyer ',
      businessName: '  Buyer Business  ',
      contactName: '  Buyer Contact  ',
      phone: '(845) 555-1212',
      comments: '  Please review  ',
    });

    const internalMessage = sendMessage.mock.calls[0][0];
    expect(internalMessage.text).toContain('Applicant type: Buyer');
    expect(internalMessage.text).toContain('Business name: Buyer Business');
    expect(internalMessage.text).toContain('Contact name: Buyer Contact');
    expect(internalMessage.text).toContain('Phone: 8455551212');
    expect(internalMessage.text).toContain('Comments: Please review');
  });

  it('rejects disabled account requests without sending email', async () => {
    const disabledConfig = {
      get: jest.fn((key: string) =>
        key === 'ACCOUNT_REQUEST_ENABLED' ? 'false' : 'unused',
      ),
    } as unknown as ConfigService;
    service = new AccountRequestService(disabledConfig, {
      sendMessage,
    } as unknown as ResendMailService);

    await expect(service.requestAccount(baseInput)).resolves.toEqual({
      success: false,
      message: 'Account requests are not available right now. Please try again later.',
      requestId: expect.any(String),
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('accepts any valid applicant email without an allowlist', async () => {
    const result = await service.requestAccount({
      ...baseInput,
      email: 'customer@example.com',
    });

    expect(result).toEqual({
      success: true,
      message:
        'Your account request has been received. We sent a confirmation to your email address.',
      requestId: expect.any(String),
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0].replyTo).toBe('customer@example.com');
    expect(sendMessage.mock.calls[1][0].to).toBe('customer@example.com');
  });

  it('limits each email to three valid requests within 15 minutes', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(
        service.requestAccount({
          ...baseInput,
          businessName: `Business ${attempt}`,
        }),
      ).resolves.toEqual({
        success: true,
        message:
          'Your account request has been received. We sent a confirmation to your email address.',
        requestId: expect.any(String),
      });
    }

    await expect(
      service.requestAccount({
        ...baseInput,
        businessName: 'Business 4',
      }),
    ).resolves.toEqual({
      success: false,
      message: 'We could not submit your account request. Please try again later.',
      requestId: expect.any(String),
    });

    expect(sendMessage).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['missing applicant type', { applicantType: '' }],
    ['invalid applicant type', { applicantType: 'Partner' }],
    ['missing business name', { businessName: '   ' }],
    ['oversized business name', { businessName: 'A'.repeat(121) }],
    ['missing contact name', { contactName: '' }],
    ['oversized contact name', { contactName: 'B'.repeat(121) }],
    ['invalid phone', { phone: '555' }],
    ['invalid email', { email: 'not-an-email' }],
    ['oversized comments', { comments: 'C'.repeat(2001) }],
    ['header injection', { contactName: 'Gerald\r\nBcc: bad@example.com' }],
  ])('rejects %s', async (_label, patch) => {
    await expect(
      service.requestAccount({
        ...baseInput,
        ...patch,
      }),
    ).resolves.toEqual({
      success: false,
      message: 'Please check the account request form and try again.',
      requestId: expect.any(String),
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('escapes customer-controlled HTML in email bodies', async () => {
    await service.requestAccount({
      ...baseInput,
      businessName: '<script>alert("x")</script>',
      comments: 'Use A & B < C',
    });

    for (const [{ html }] of sendMessage.mock.calls) {
      expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
      expect(html).toContain('Use A &amp; B &lt; C');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('Use A & B < C');
    }
  });

  it('does not send the customer acknowledgment when internal delivery fails', async () => {
    sendMessage.mockRejectedValueOnce(new Error('token secret failed'));

    await expect(service.requestAccount(baseInput)).resolves.toEqual({
      success: false,
      message: 'We could not submit your account request. Please try again later.',
      requestId: expect.any(String),
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain(
      'token secret failed',
    );
  });

  it('does not duplicate internal delivery when customer acknowledgment fails', async () => {
    sendMessage
      .mockResolvedValueOnce({ id: 'internal-message-id' })
      .mockRejectedValueOnce(new Error('customer send failed'));

    await expect(service.requestAccount(baseInput)).resolves.toEqual({
      success: false,
      message:
        'Your account request was received, but we could not send a confirmation email.',
      requestId: expect.any(String),
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0].to).toBe('orders@ksesuppliers.com');
    expect(sendMessage.mock.calls[1][0].to).toBe('gerald.latagan@gmail.com');
  });
});
