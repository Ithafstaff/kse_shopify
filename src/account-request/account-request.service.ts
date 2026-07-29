import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AccountRequestInput } from './account-request.input';
import { AccountRequestResult } from './account-request.model';
import {
  NormalizedAccountRequest,
  buildCustomerAccountRequestEmail,
  buildInternalAccountRequestEmail,
} from './email-templates';
import { GmailMailService } from './gmail-mail.service';

const GENERIC_VALIDATION_MESSAGE =
  'Please check the account request form and try again.';
const GENERIC_INTERNAL_FAILURE_MESSAGE =
  'We could not submit your account request. Please try again later.';
const DISABLED_MESSAGE =
  'Account requests are not available right now. Please try again later.';
const ALLOWLIST_MESSAGE =
  'Account requests are not available for this email address.';
const CUSTOMER_EMAIL_FAILURE_MESSAGE =
  'Your account request was received, but we could not send a confirmation email.';

@Injectable()
export class AccountRequestService {
  private readonly recentSubmissions = new Map<string, number[]>();

  constructor(
    private readonly configService: ConfigService,
    private readonly gmailMailService: GmailMailService,
  ) {}

  async requestAccount(
    input: AccountRequestInput,
  ): Promise<AccountRequestResult> {
    const requestId = this.createRequestId();

    if (!this.isEnabled()) {
      console.warn('Account request rejected because feature is disabled.', {
        requestId,
      });
      return { success: false, message: DISABLED_MESSAGE, requestId };
    }

    const normalized = this.normalize(input);
    if (!normalized) {
      console.warn('Account request rejected by validation.', { requestId });
      return {
        success: false,
        message: GENERIC_VALIDATION_MESSAGE,
        requestId,
      };
    }

    if (!this.isAllowedApplicant(normalized.email)) {
      console.warn('Account request rejected by applicant allowlist.', {
        requestId,
      });
      return { success: false, message: ALLOWLIST_MESSAGE, requestId };
    }

    if (!this.consumeRateLimit(normalized.email)) {
      console.warn('Account request rejected by rate limit.', { requestId });
      return {
        success: false,
        message: GENERIC_INTERNAL_FAILURE_MESSAGE,
        requestId,
      };
    }

    const senderEmail = this.configService.get<string>('GMAIL_SENDER_EMAIL');
    const senderName = this.configService.get<string>('GMAIL_SENDER_NAME');
    const fallbackReplyTo = this.configService.get<string>('GMAIL_REPLY_TO');
    const internalRecipient = this.configService.get<string>(
      'ACCOUNT_REQUEST_RECIPIENT',
    );

    if (!senderEmail || !internalRecipient) {
      console.error('Account request email configuration is incomplete.', {
        requestId,
        missingSender: !senderEmail,
        missingRecipient: !internalRecipient,
      });
      return {
        success: false,
        message: GENERIC_INTERNAL_FAILURE_MESSAGE,
        requestId,
      };
    }

    const submittedAt = new Date();
    const internalEmail = buildInternalAccountRequestEmail(
      normalized,
      requestId,
      submittedAt,
    );
    const customerEmail = buildCustomerAccountRequestEmail(
      normalized,
      requestId,
    );

    try {
      await this.gmailMailService.sendMessage({
        from: { email: senderEmail, name: senderName },
        to: internalRecipient,
        replyTo: normalized.email,
        ...internalEmail,
      });
    } catch (error) {
      console.error('Account request internal email failed.', {
        requestId,
        errorClass: this.classifyError(error),
      });
      return {
        success: false,
        message: GENERIC_INTERNAL_FAILURE_MESSAGE,
        requestId,
      };
    }

    try {
      await this.gmailMailService.sendMessage({
        from: { email: senderEmail, name: senderName },
        to: normalized.email,
        replyTo: fallbackReplyTo || senderEmail,
        ...customerEmail,
      });
    } catch (error) {
      console.error('Account request customer email failed.', {
        requestId,
        errorClass: this.classifyError(error),
      });
      return {
        success: false,
        message: CUSTOMER_EMAIL_FAILURE_MESSAGE,
        requestId,
      };
    }

    console.log('Account request emails sent.', { requestId });
    return {
      success: true,
      message:
        'Your account request has been received. We sent a confirmation to your email address.',
      requestId,
    };
  }

  private normalize(
    input: AccountRequestInput,
  ): NormalizedAccountRequest | null {
    if (!input || this.hasHeaderInjection(input)) {
      return null;
    }

    const applicantType = this.normalizeApplicantType(input.applicantType);
    const businessName = this.cleanText(input.businessName);
    const contactName = this.cleanText(input.contactName);
    const phone = String(input.phone || '').replace(/\D/g, '');
    const email = this.cleanText(input.email).toLowerCase();
    const comments = this.cleanText(input.comments || '');

    if (!applicantType) return null;
    if (!businessName || businessName.length > 120) return null;
    if (!contactName || contactName.length > 120) return null;
    if (!/^[0-9]{10}$/.test(phone)) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return null;
    }
    if (comments.length > 2000) return null;

    return {
      applicantType,
      businessName,
      contactName,
      phone,
      email,
      comments,
    };
  }

  private normalizeApplicantType(value: string): 'Vendor' | 'Buyer' | null {
    const normalized = this.cleanText(value).toLowerCase();
    if (normalized === 'vendor') return 'Vendor';
    if (normalized === 'buyer') return 'Buyer';
    return null;
  }

  private cleanText(value: string | undefined): string {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  private hasHeaderInjection(input: AccountRequestInput): boolean {
    return Object.values(input).some((value) => /[\r\n]/.test(String(value)));
  }

  private isEnabled(): boolean {
    return this.configService.get<string>('ACCOUNT_REQUEST_ENABLED') === 'true';
  }

  private isAllowedApplicant(email: string): boolean {
    const allowed = this.configService.get<string>(
      'ACCOUNT_REQUEST_ALLOWED_APPLICANT_EMAIL',
    );

    return Boolean(allowed && allowed.toLowerCase() === email.toLowerCase());
  }

  private consumeRateLimit(email: string): boolean {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const key = email.toLowerCase();
    const recent = (this.recentSubmissions.get(key) || []).filter(
      (timestamp) => now - timestamp < windowMs,
    );

    if (recent.length >= 3) {
      this.recentSubmissions.set(key, recent);
      return false;
    }

    recent.push(now);
    this.recentSubmissions.set(key, recent);
    return true;
  }

  private createRequestId(): string {
    return `KSE-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private classifyError(error: unknown): string {
    if (typeof error === 'object' && error && 'code' in error) {
      return String((error as { code: unknown }).code);
    }

    return error instanceof Error ? error.name : 'UnknownError';
  }
}
