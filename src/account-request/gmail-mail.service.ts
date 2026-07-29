import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface GmailMessage {
  from: {
    email: string;
    name?: string;
  };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class GmailMailService {
  constructor(private readonly configService: ConfigService) {}

  async sendMessage(message: GmailMessage): Promise<{ id: string }> {
    const accessToken = await this.getAccessToken();
    const raw = this.buildRawMessage(message);
    const response = await axios.post(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      { raw },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    return { id: response.data?.id };
  }

  private async getAccessToken(): Promise<string> {
    const clientId = this.requiredConfig('GMAIL_CLIENT_ID');
    const clientSecret = this.requiredConfig('GMAIL_CLIENT_SECRET');
    const refreshToken = this.requiredConfig('GMAIL_REFRESH_TOKEN');

    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      },
    );

    if (!response.data?.access_token) {
      throw new Error('Gmail access token response was missing access_token.');
    }

    return response.data.access_token;
  }

  private buildRawMessage(message: GmailMessage): string {
    const boundary = `kse_account_request_${Date.now()}`;
    const lines = [
      `From: ${this.formatMailbox(message.from.email, message.from.name)}`,
      `To: ${message.to}`,
      message.replyTo ? `Reply-To: ${message.replyTo}` : null,
      `Subject: ${this.encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.html,
      '',
      `--${boundary}--`,
    ].filter((line): line is string => line !== null);

    return Buffer.from(lines.join('\r\n'), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private formatMailbox(email: string, name?: string): string {
    if (!name) {
      return email;
    }

    return `${this.encodeHeader(name)} <${email}>`;
  }

  private encodeHeader(value: string): string {
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`${key} is not configured.`);
    }
    return value;
  }
}
