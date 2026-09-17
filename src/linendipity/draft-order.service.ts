import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DraftAttemptClaim,
  DraftAttemptConflictError,
  DraftAttemptRepository,
} from './draft-attempt.repository';
import { DraftSaveItem, DraftSaveRequest } from './draft-input';
import { AdminGraphqlClient } from './shopify.service';

export class DraftOrderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DraftOrderError';
  }
}

export type DraftRequestContext = {
  shop: string;
  customerId: string;
  admin: AdminGraphqlClient;
};

export type DraftMoney = {
  amount: string;
  currencyCode: string;
};

export type DraftPage = {
  orders: Array<{
    id: string;
    name: string;
    createdAt: string;
    status: string;
    total: DraftMoney;
    itemCount: number;
    lineItems: Array<{
      title: string;
      variantTitle: string | null;
      quantity: number;
      unitPrice: DraftMoney;
      totalPrice: DraftMoney;
      properties: Array<{ key: string; value: string }>;
    }>;
  }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;
const CLIENT_PRICE_FIELD = /(?:^|_)(?:price|subtotal|total)(?:$|_)/i;

function invalid(code = 'INVALID_DRAFT_REQUEST'): never {
  throw new DraftOrderError(422, code, 'The cart could not be saved.');
}

export function normalizeDraftRequest(value: unknown): DraftSaveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const rawItems = input.items;

  if (
    !UUID_PATTERN.test(idempotencyKey) ||
    !Array.isArray(rawItems) ||
    rawItems.length < 1 ||
    rawItems.length > 100
  ) {
    invalid();
  }

  const items = rawItems.map((raw): DraftSaveItem => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => CLIENT_PRICE_FIELD.test(key))) {
      invalid('CLIENT_PRICE_REJECTED');
    }

    const rawVariantId = String(item.variantId || '').trim();
    const numericVariantId = /^\d+$/.test(rawVariantId)
      ? rawVariantId
      : rawVariantId.match(VARIANT_GID_PATTERN)?.[1];
    const quantity = Number(item.quantity);

    if (
      !numericVariantId ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      invalid();
    }

    const rawProperties = item.properties ?? [];
    if (!Array.isArray(rawProperties) || rawProperties.length > 20) invalid();
    const properties = rawProperties
      .map((property) => {
        if (!property || typeof property !== 'object' || Array.isArray(property)) {
          invalid();
        }
        const key = String((property as Record<string, unknown>).key || '').trim();
        const propertyValue = String(
          (property as Record<string, unknown>).value ?? '',
        ).trim();
        if (!key || key.length > 64 || propertyValue.length > 255) invalid();
        return { key, value: propertyValue };
      })
      .filter((property) => property.value.length > 0);

    return {
      variantId: `gid://shopify/ProductVariant/${numericVariantId}`,
      quantity,
      ...(properties.length ? { properties } : {}),
    };
  });

  return { idempotencyKey, items };
}

@Injectable()
export class DraftOrderService {
  constructor(
    @Inject(DraftAttemptRepository)
    private readonly attempts: Pick<
      DraftAttemptRepository,
      'claim' | 'complete' | 'fail'
    >,
  ) {}

  async listDrafts(
    context: DraftRequestContext,
    pagination: { first?: string | number; after?: string } = {},
  ): Promise<DraftPage> {
    const requestedFirst = Number(pagination.first ?? 10);
    const first = Number.isFinite(requestedFirst)
      ? Math.max(1, Math.min(10, Math.trunc(requestedFirst)))
      : 10;
    const after = pagination.after?.trim() || null;
    if (
      after &&
      (after.length > 512 || !/^[A-Za-z0-9+/_=-]+$/.test(after))
    ) {
      throw new DraftOrderError(
        422,
        'INVALID_CURSOR',
        'The draft-order page cursor is invalid.',
      );
    }

    const response = await context.admin.request<DraftListResponse>(
      `query LinendipityCustomerDrafts(
        $first: Int!
        $after: String
        $query: String!
      ) {
        draftOrders(
          first: $first
          after: $after
          query: $query
          sortKey: CREATED_AT
          reverse: true
        ) {
          nodes {
            id
            name
            createdAt
            status
            totalPriceSet { shopMoney { amount currencyCode } }
            totalQuantityOfLineItems
            customer { id }
            lineItems(first: 100) {
              nodes {
                title
                variantTitle
                quantity
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                originalTotalSet { shopMoney { amount currencyCode } }
                customAttributes { key value }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        draftOrdersCount(query: $query) { count }
      }`,
      {
        variables: {
          first,
          after,
          query: `customer_id:${context.customerId} tag:LinendipityDraft`,
        },
      },
    );
    this.assertGraphqlResponse(response);

    const result = response.data;
    if (!result?.draftOrders?.nodes || !result.draftOrders.pageInfo) {
      throw new DraftOrderError(
        502,
        'SHOPIFY_DRAFT_FAILED',
        'We could not load your draft orders. Please try again.',
      );
    }

    const expectedCustomer = `gid://shopify/Customer/${context.customerId}`;
    if (
      result.draftOrders.nodes.some(
        (draft) => draft.customer?.id !== expectedCustomer,
      )
    ) {
      throw new DraftOrderError(
        403,
        'DRAFT_OWNERSHIP_MISMATCH',
        'A draft order could not be verified for this customer.',
      );
    }

    return {
      orders: result.draftOrders.nodes.map((draft) => ({
        id: draft.id,
        name: draft.name,
        createdAt: draft.createdAt,
        status: draft.status,
        total: draft.totalPriceSet.shopMoney,
        itemCount: draft.totalQuantityOfLineItems,
        lineItems: draft.lineItems.nodes.map((line) => ({
          title: line.title,
          variantTitle: line.variantTitle,
          quantity: line.quantity,
          unitPrice: line.originalUnitPriceSet.shopMoney,
          totalPrice: line.originalTotalSet.shopMoney,
          properties: (line.customAttributes || []).filter(
            (property) => !property.key.startsWith('_'),
          ),
        })),
      })),
      pageInfo: result.draftOrders.pageInfo,
      totalCount:
        typeof result.draftOrdersCount?.count === 'number'
          ? result.draftOrdersCount.count
          : null,
    };
  }

  async createDraft(
    context: DraftRequestContext,
    request: DraftSaveRequest,
  ): Promise<{ id: string; name: string }> {
    const fingerprint = this.fingerprint(request.items);
    let claim: DraftAttemptClaim;
    try {
      claim = await this.attempts.claim(
        context.shop,
        context.customerId,
        request.idempotencyKey,
        fingerprint,
      );
    } catch (error) {
      if (error instanceof DraftAttemptConflictError) {
        throw new DraftOrderError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This save attempt no longer matches the current cart. Please start again.',
        );
      }
      throw error;
    }

    if (claim.kind === 'replay') return claim.draft;

    try {
      const customer = await this.loadCustomer(context);
      const attemptTag = this.attemptTag(
        context.shop,
        context.customerId,
        request.idempotencyKey,
      );
      const recovered = await this.findByAttemptTag(context, attemptTag);

      if (recovered) {
        await this.attempts.complete(
          context.shop,
          context.customerId,
          request.idempotencyKey,
          recovered,
        );
        return recovered;
      }

      if (claim.kind === 'in_progress') {
        throw new DraftOrderError(
          409,
          'DRAFT_SAVE_IN_PROGRESS',
          'This draft order is still being saved. Please try again.',
        );
      }

      const draft = await this.createShopifyDraft(
        context,
        request,
        customer.defaultAddress,
        attemptTag,
      );
      await this.attempts.complete(
        context.shop,
        context.customerId,
        request.idempotencyKey,
        draft,
      );
      return draft;
    } catch (error) {
      if (
        !(error instanceof DraftOrderError) ||
        error.code !== 'DRAFT_SAVE_IN_PROGRESS'
      ) {
        await this.attempts.fail(
          context.shop,
          context.customerId,
          request.idempotencyKey,
          error instanceof DraftOrderError ? error.code : 'SHOPIFY_DRAFT_FAILED',
        );
      }
      if (error instanceof DraftOrderError) throw error;
      throw new DraftOrderError(
        502,
        'SHOPIFY_DRAFT_FAILED',
        'We could not save your draft order. Please try again.',
      );
    }
  }

  private async loadCustomer(context: DraftRequestContext): Promise<{
    defaultAddress: Record<string, string>;
  }> {
    const response = await context.admin.request<{
      customer: {
        id: string;
        defaultAddress: Record<string, string | null> | null;
      } | null;
    }>(
      `query LinendipityDraftCustomer($id: ID!) {
        customer(id: $id) {
          id
          defaultAddress {
            firstName lastName company address1 address2 city
            provinceCode countryCodeV2 zip phone
          }
        }
      }`,
      { variables: { id: `gid://shopify/Customer/${context.customerId}` } },
    );
    this.assertGraphqlResponse(response);
    const address = response.data?.customer?.defaultAddress;
    const required = [
      address?.firstName,
      address?.lastName,
      address?.address1,
      address?.city,
      address?.provinceCode,
      address?.zip,
    ];
    if (
      !address ||
      address.countryCodeV2 !== 'US' ||
      required.some((field) => !String(field || '').trim())
    ) {
      throw new DraftOrderError(
        422,
        'DEFAULT_ADDRESS_REQUIRED',
        'Add a complete default US shipping address before saving your cart.',
      );
    }

    return {
      defaultAddress: {
        firstName: String(address.firstName),
        lastName: String(address.lastName),
        company: String(address.company || ''),
        address1: String(address.address1),
        address2: String(address.address2 || ''),
        city: String(address.city),
        province: String(address.provinceCode),
        country: 'US',
        zip: String(address.zip),
        phone: String(address.phone || ''),
      },
    };
  }

  private async findByAttemptTag(
    context: DraftRequestContext,
    attemptTag: string,
  ): Promise<{ id: string; name: string } | null> {
    const response = await context.admin.request<{
      draftOrders: { nodes: Array<{ id: string; name: string; customer: { id: string } | null }> };
    }>(
      `query LinendipityRecoverDraft($query: String!) {
        draftOrders(first: 2, query: $query, reverse: true) {
          nodes { id name customer { id } }
        }
      }`,
      {
        variables: {
          query: `customer_id:${context.customerId} tag:${attemptTag}`,
        },
      },
    );
    this.assertGraphqlResponse(response);
    const expectedCustomer = `gid://shopify/Customer/${context.customerId}`;
    const found = response.data?.draftOrders?.nodes?.find(
      (draft) => draft.customer?.id === expectedCustomer,
    );
    return found ? { id: found.id, name: found.name } : null;
  }

  private async createShopifyDraft(
    context: DraftRequestContext,
    request: DraftSaveRequest,
    shippingAddress: Record<string, string>,
    attemptTag: string,
  ): Promise<{ id: string; name: string }> {
    const response = await context.admin.request<{
      draftOrderCreate: {
        draftOrder: { id: string; name: string } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    }>(
      `mutation LinendipityCreateDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            customerId: `gid://shopify/Customer/${context.customerId}`,
            lineItems: request.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              ...(item.properties?.length
                ? { customAttributes: item.properties }
                : {}),
            })),
            shippingAddress,
            tags: ['LinendipityDraft', attemptTag],
          },
        },
      },
    );
    this.assertGraphqlResponse(response);
    const result = response.data?.draftOrderCreate;
    if (result?.userErrors?.length || !result?.draftOrder) {
      throw new DraftOrderError(
        502,
        'SHOPIFY_DRAFT_FAILED',
        'We could not save your draft order. Please try again.',
      );
    }
    return result.draftOrder;
  }

  private assertGraphqlResponse(response: { data?: unknown; errors?: unknown }): void {
    if (response?.errors || !response?.data) {
      throw new DraftOrderError(
        502,
        'SHOPIFY_DRAFT_FAILED',
        'We could not save your draft order. Please try again.',
      );
    }
  }

  private fingerprint(items: DraftSaveItem[]): string {
    return createHash('sha256').update(JSON.stringify(items)).digest('hex');
  }

  private attemptTag(shop: string, customerId: string, key: string): string {
    const digest = createHash('sha256')
      .update(`${shop}:${customerId}:${key}`)
      .digest('hex')
      .slice(0, 32);
    return `LinendipityAttempt_${digest}`;
  }
}

type DraftListResponse = {
  draftOrders: {
    nodes: Array<{
      id: string;
      name: string;
      createdAt: string;
      status: string;
      totalPriceSet: { shopMoney: DraftMoney };
      totalQuantityOfLineItems: number;
      customer: { id: string } | null;
      lineItems: {
        nodes: Array<{
          title: string;
          variantTitle: string | null;
          quantity: number;
          originalUnitPriceSet: { shopMoney: DraftMoney };
          originalTotalSet: { shopMoney: DraftMoney };
          customAttributes: Array<{ key: string; value: string }>;
        }>;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  draftOrdersCount?: { count: number } | null;
};

export type { DraftAttemptClaim };
