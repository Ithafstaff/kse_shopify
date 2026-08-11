import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ResendMailMessage {
  from?: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

type ResendProviderError = Error & {
  code?: string;
  response?: {
    status?: number;
  };
};

type SanitizedMailError = Error & {
  code?: string;
  statusCode?: number;
};

@Injectable()
export class ResendMailService {
  constructor(private readonly configService: ConfigService) {}

  async sendMessage(message: ResendMailMessage): Promise<{ id: string }> {
    const apiKey = this.requiredConfig('RESEND_API_KEY');
    const configuredFrom = this.requiredConfig('EMAIL_FROM');

    let response: { data?: { id?: string } };
    try {
      response = await axios.post(
        'https://api.resend.com/emails',
        {
          from: message.from || configuredFrom,
          to: [message.to],
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        },
      );
    } catch (error) {
      throw this.sanitizeProviderError(error);
    }

    if (!response.data?.id) {
      const error = new Error('Resend email delivery failed.') as SanitizedMailError;
      error.code = 'RESEND_INVALID_RESPONSE';
      throw error;
    }

    return { id: response.data.id };
  }

  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`${key} is not configured.`);
    }
    return value;
  }

  private sanitizeProviderError(error: unknown): SanitizedMailError {
    const providerError = error as ResendProviderError;
    const sanitizedError = new Error(
      'Resend email delivery failed.',
    ) as SanitizedMailError;

    if (providerError && typeof providerError.code === 'string') {
      sanitizedError.code = providerError.code;
    }

    if (typeof providerError?.response?.status === 'number') {
      sanitizedError.statusCode = providerError.response.status;
    }

    return sanitizedError;
  }
}
