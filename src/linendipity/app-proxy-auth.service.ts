import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminGraphqlClient, ShopifyService } from './shopify.service';

export type AppProxyQuery = Record<
  string,
  string | string[] | undefined
>;

export class AppProxyAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Customer account identity could not be verified.');
    this.name = 'AppProxyAuthError';
  }
}

@Injectable()
export class AppProxyAuthService {
  private readonly secret: string;
  private readonly expectedShop: string;

  constructor(
    config: ConfigService,
    private readonly shopify: ShopifyService,
  ) {
    this.secret = config.get<string>('SHOPIFY_API_SECRET')?.trim() || '';
    this.expectedShop = config.get<string>('SHOPIFY_SHOP')?.trim() || '';
  }

  async authenticate(
    query: AppProxyQuery,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<{
    shop: string;
    customerId: string;
    admin: AdminGraphqlClient;
  }> {
    const signature = this.value(query, 'signature');
    const shop = this.value(query, 'shop');
    const customerId = this.value(query, 'logged_in_customer_id');
    const timestampValue = this.value(query, 'timestamp');

    if (
      !this.secret ||
      !signature ||
      shop !== this.expectedShop ||
      !customerId ||
      !/^\d+$/.test(customerId) ||
      !timestampValue ||
      !/^\d+$/.test(timestampValue) ||
      !this.validSignature(query, signature)
    ) {
      throw new AppProxyAuthError(401, 'APP_PROXY_UNAUTHORIZED');
    }

    const timestamp = Number(timestampValue);
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > 300
    ) {
      throw new AppProxyAuthError(401, 'APP_PROXY_UNAUTHORIZED');
    }

    const admin = await this.shopify.adminFor(shop);
    return { shop, customerId, admin };
  }

  private validSignature(query: AppProxyQuery, signature: string): boolean {
    const message = Object.entries(query)
      .filter(([key]) => key !== 'signature')
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(',') : String(value ?? ''),
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('');
    const expected = createHmac('sha256', this.secret)
      .update(message)
      .digest('hex');

    try {
      const suppliedBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');
      return (
        suppliedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(suppliedBuffer, expectedBuffer)
      );
    } catch {
      return false;
    }
  }

  private value(query: AppProxyQuery, key: string): string | undefined {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  }
}
