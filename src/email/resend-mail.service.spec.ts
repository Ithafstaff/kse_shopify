import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { ResendMailMessage, ResendMailService } from './resend-mail.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

const mockedPost = axios.post as jest.Mock;
const FROM = 'KSE Suppliers <orders@notifications.ksesuppliers.com>';

const validMessage: ResendMailMessage = {
  to: 'customer@example.com',
  replyTo: 'cs@ksesuppliers.com',
  subject: 'Subject',
  text: 'Plain text',
  html: '<p>HTML</p>',
};

function configService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('ResendMailService', () => {
  let service: ResendMailService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPost.mockResolvedValue({ data: { id: 'resend-message-id' } });
    service = new ResendMailService(
      configService({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: FROM }),
    );
  });

  it('posts a Resend message with configured sender and reply-to', async () => {
    await service.sendMessage(validMessage);

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      {
        from: FROM,
        to: ['customer@example.com'],
        reply_to: 'cs@ksesuppliers.com',
        subject: 'Subject',
        text: 'Plain text',
        html: '<p>HTML</p>',
      },
      {
        headers: {
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      },
    );
  });

  it('uses an explicit sender when provided', async () => {
    await service.sendMessage({
      ...validMessage,
      from: 'Alternate <orders@notifications.ksesuppliers.com>',
    });

    expect(mockedPost.mock.calls[0][1].from).toBe(
      'Alternate <orders@notifications.ksesuppliers.com>',
    );
  });

  it('returns the Resend message id', async () => {
    await expect(service.sendMessage(validMessage)).resolves.toEqual({
      id: 'resend-message-id',
    });
  });

  it('rejects without making a request when the API key is missing', async () => {
    const serviceWithMissingApiKey = new ResendMailService(
      configService({ EMAIL_FROM: FROM }),
    );

    await expect(
      serviceWithMissingApiKey.sendMessage(validMessage),
    ).rejects.toThrow('RESEND_API_KEY is not configured.');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('throws sanitized provider diagnostics without exposing the raw response', async () => {
    mockedPost.mockRejectedValue(
      Object.assign(new Error('provider secret response'), {
        code: 'ERR_BAD_RESPONSE',
        response: { status: 401, data: { secret: 'do-not-log' } },
      }),
    );

    let thrownError: unknown;
    try {
      await service.sendMessage(validMessage);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toMatchObject({
      message: 'Resend email delivery failed.',
      code: 'ERR_BAD_RESPONSE',
      statusCode: 401,
    });
    expect(JSON.stringify(thrownError)).not.toContain('do-not-log');
    expect(JSON.stringify(thrownError)).not.toContain(
      'provider secret response',
    );
  });
});
