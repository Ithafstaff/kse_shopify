import '@shopify/shopify-api/adapters/node';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiVersion,
  Session,
  shopifyApi,
} from '@shopify/shopify-api';
import { Request, Response } from 'express';
import { SessionRepository } from './session.repository';

export type AdminGraphqlClient = {
  request<T = unknown>(
    operation: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<{ data?: T; errors?: unknown }>;
};

@Injectable()
export class ShopifyService {
  private readonly expectedShop: string;
  private readonly shopify;

  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionRepository,
  ) {
    const apiKey = this.required('SHOPIFY_API_KEY');
    const apiSecretKey = this.required('SHOPIFY_API_SECRET');
    const appUrl = new URL(this.required('SHOPIFY_APP_URL'));
    this.expectedShop = this.required('SHOPIFY_SHOP');
    this.shopify = shopifyApi({
      apiKey,
      apiSecretKey,
      apiVersion: ApiVersion.July26,
      hostName: appUrl.host,
      hostScheme: appUrl.protocol === 'http:' ? 'http' : 'https',
      isEmbeddedApp: false,
      scopes: [
        'customer_read_customers',
        'customer_write_customers',
        'read_customers',
        'read_draft_orders',
        'write_draft_orders',
      ],
    });
  }

  async beginInstall(
    request: Request,
    response: Response,
    shop: string,
  ): Promise<void> {
    if (shop !== this.expectedShop) {
      response.status(403).send('This app is not available for that shop.');
      return;
    }

    await this.shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: request,
      rawResponse: response,
    });
  }

  async completeInstall(request: Request, response: Response): Promise<Session> {
    const { session } = await this.shopify.auth.callback({
      rawRequest: request,
      rawResponse: response,
    });

    if (session.shop !== this.expectedShop || session.isOnline) {
      throw new Error('Unexpected Shopify installation session.');
    }

    await this.sessions.store(session);
    return session;
  }

  async adminFor(shop: string): Promise<AdminGraphqlClient> {
    if (shop !== this.expectedShop) {
      throw new Error('Shopify shop is not configured.');
    }

    const session = await this.sessions.loadOffline(shop);
    if (!session?.accessToken) {
      throw new Error('Shopify offline session is unavailable.');
    }

    return new this.shopify.clients.Graphql({ session });
  }

  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
  }
}
