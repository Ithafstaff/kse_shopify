import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { LineItemInput } from './dto/draft-order.input';
import { ConfigService } from '@nestjs/config';
import { ShippingAddressInput } from './dto/shipping-address.input';
import { MetafieldInput } from './dto/metafield.input';
import * as nodemailer from 'nodemailer';
import { DraftOrderTag } from './dto/draft-order-tag.model';
import {
  CompanyDraftOrderPage,
  DraftOrder,
  DraftOrderPage,
} from './draft-order.model';
import { Address, User } from './user.model';
import { AddressInput } from './dto/address.input';
import { title } from 'process';
import { CustomerCompany } from './dto/customer-company.dto';
import { skip } from 'rxjs';

@Injectable()
export class AppService {
  private readonly shopifyApiUrl: string;
  private readonly shopifyRestUrl2: string;
  private readonly shopifyAccessToken: string;
  private readonly tags: DraftOrderTag[] = [];
  private readonly shopId: string = 'gid://shopify/Shop/78220263608';

  constructor(private readonly configService: ConfigService) {
    this.shopifyApiUrl = this.configService.get<string>('SHOPIFY_API_URL');
    this.shopifyAccessToken = this.configService.get<string>(
      'SHOPIFY_ACCESS_TOKEN',
    );
    this.shopifyRestUrl2 = this.configService.get<string>(
      'SHOPIFY_REST_API_URL_2',
    );
  }

  private encodeCompanyOrderCursor(lastConsumedEdgeCursor: string): string {
    return Buffer.from(
      JSON.stringify({ version: 1, lastConsumedEdgeCursor }),
      'utf8',
    ).toString('base64url');
  }

  private decodeCompanyOrderCursor(cursor?: string): string | null {
    if (!cursor) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );

      if (
        payload?.version !== 1 ||
        typeof payload.lastConsumedEdgeCursor !== 'string' ||
        payload.lastConsumedEdgeCursor.length === 0
      ) {
        throw new Error('Invalid company order cursor.');
      }

      return payload.lastConsumedEdgeCursor;
    } catch {
      throw new Error('Invalid company order cursor.');
    }
  }

  private normalizeCompanyName(company: string): string {
    return company.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private orderMatchesCompany(tags: string[] = [], company: string): boolean {
    const requestedCompany = this.normalizeCompanyName(company);
    if (!requestedCompany) return false;

    return tags.some((tag) => {
      if (!tag.startsWith('company:')) return false;

      const orderCompany = this.normalizeCompanyName(
        tag.replace('company:', '').trim(),
      );
      if (!orderCompany) return false;

      return (
        orderCompany === requestedCompany ||
        orderCompany.includes(requestedCompany) ||
        requestedCompany.includes(orderCompany)
      );
    });
  }

  private orderMatchesPoSearch(tags: string[] = [], poSearch?: string): boolean {
    const requestedPo = poSearch?.trim().toLowerCase();
    if (!requestedPo) return true;

    return tags.some((tag) => {
      if (!tag.startsWith('PO:')) return false;

      const orderPo = tag.replace(/^PO:\s*/, '').trim().toLowerCase();
      return orderPo.includes(requestedPo);
    });
  }

  private normalizeOrderSearchValue(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private orderTagValue(tags: string[] = [], prefix: string): string {
    const tag = tags.find((value) => value.startsWith(prefix));
    return tag ? tag.slice(prefix.length).trim() : '';
  }

  private orderMatchesSearch(order: any, search?: string): boolean {
    const requestedSearch = this.normalizeOrderSearchValue(search);
    if (!requestedSearch) return true;

    const tags = Array.isArray(order.tags) ? order.tags : [];
    const customerFirstName =
      order.customer?.firstName || this.orderTagValue(tags, 'FirstName:');
    const customerLastName =
      order.customer?.lastName || this.orderTagValue(tags, 'LastName:');
    const searchableValues = [
      order.name,
      order.note2,
      customerFirstName,
      customerLastName,
      `${customerFirstName} ${customerLastName}`.trim(),
      order.customer?.email,
      order.shippingAddress?.address1,
      order.shippingAddress?.address2,
      order.shippingAddress?.city,
      order.shippingAddress?.province,
      order.shippingAddress?.country,
      order.shippingAddress?.zip,
      order.shippingAddress?.company,
      this.orderTagValue(tags, 'FirstName:'),
      this.orderTagValue(tags, 'LastName:'),
      this.orderTagValue(tags, 'email:'),
      this.orderTagValue(tags, 'company:'),
      this.orderTagValue(tags, 'PO:'),
      this.orderTagValue(tags, 'Address1:'),
      this.orderTagValue(tags, 'Address2:'),
      this.orderTagValue(tags, 'City:'),
      this.orderTagValue(tags, 'Province:'),
      this.orderTagValue(tags, 'Country:'),
      this.orderTagValue(tags, 'Zip:'),
      this.orderTagValue(tags, 'NOTES:'),
      ...(order.lineItems?.edges || []).flatMap((edge) => [
        edge.node?.title,
        edge.node?.name,
        edge.node?.sku,
        edge.node?.variant?.title,
      ]),
    ];

    return searchableValues.some(
      (value) =>
        this.normalizeOrderSearchValue(value).includes(requestedSearch),
    );
  }

  escapeGraphQLString(str: string): string {
    if (!str) return '';
    return str
      .replace(/\\/g, '\\\\') // escape backslashes
      .replace(/"/g, '\\"') // escape double quotes
      .replace(/\n/g, '\\n') // escape newlines
      .replace(/\r/g, '') // remove carriage returns if any
      .trim();
  }

  /** 
   * CUSTOMER SERVICES
   */

  // Create a new customer and send an account invite email
  async createCustomer(
    firstName: string,
    lastName: string,
    addresses: AddressInput[],
    email?: string,
  ): Promise<User> {
    let priceLevel = null;

    const companyPriceLevels = await this.getCompanyPriceLevel();
    for (const [companyName, companyPriceLevel] of Object.entries(companyPriceLevels)) {
      if (companyName === addresses[0].company) {
        priceLevel = companyPriceLevel;
        break;
      }
    }

    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            firstName
            lastName
            email
            addresses {
              address1
              city
              company
              province
              country
              zip
            }
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        firstName: this.escapeGraphQLString(firstName) || 'N/A',
        lastName: this.escapeGraphQLString(lastName) || 'N/A',
        email: this.escapeGraphQLString(email) || '',
        addresses: addresses.map((address) => ({
          address1: this.escapeGraphQLString(address.address1) || 'N/A',
          address2: this.escapeGraphQLString(address.address2) || '',
          company: this.escapeGraphQLString(address.company) || '',
          city: this.escapeGraphQLString(address.city) || 'N/A',
          province: this.escapeGraphQLString(address.province) || 'New York',
          country: this.escapeGraphQLString(address.country) || 'United States',
          zip: this.escapeGraphQLString(address.zip) || '10012',
        })),
        tags: [priceLevel],
      },
    };

    const data = await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: { query: mutation, variables },
    })
      .then((response) => {
        if (response.data.data.customerCreate.userErrors.length > 0) {
          throw new Error(
            response.data.data.customerCreate.userErrors
              .map((e) => e.message)
              .join(', '),
          );
        }
        if (!response || !response.data || !response.data.data) {
          throw new Error(
            response.data.errors
              ? response.data.errors[0].message
              : 'No data returned from Shopify API',
          );
        }
        return response.data.data.customerCreate;
      })
      .catch((error) => {
        console.error('Error creating user:', error.message);
        throw new Error('Failed to create user.');
      });

    if (!data || !data.customer) {
      console.log('User creation failed:', data);
      throw new Error('User creation failed.');
    }

    console.log('User created successfully! Sending email invite...');

    await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
          mutation {
            customerSendAccountInviteEmail(customerId: "${data.customer.id}") {
              customer {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
      },
    })
      .catch((error) => {
        console.error('Error sending account invite email:', error.message);
        throw new Error('Failed to send account invite email.');
      });

    return data.customer;
  }

  // Get all customers of the shop
  async getCustomers() {
    const response = await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
          {
            customers(first: 100) {
              edges {
                node {
                  id
                  firstName
                  lastName
                  email
                  addresses {
                    address1
                    address2
                    company
                    city
                    province
                    country
                    zip
                  }
                  defaultAddress {
                    address1
                    company
                    city
                    province
                    country
                    zip
                  }
                  tags
                }
              }
            }
          }
        `,
      },
    });

    const customers = response.data.data.customers.edges.map((edge) => ({
      id: edge.node.id,
      firstName: edge.node.firstName || 'N/A',
      lastName: edge.node.lastName || 'N/A',
      email: edge.node.email || 'N/A',
      addresses: edge.node.addresses.map((address) => ({
        address1: address.address1,
        address2: address.address2,
        company: address.company,
        city: address.city,
        province: address.province,
        country: address.country,
        zip: address.zip,
      })),
      defaultAddress: edge.node.defaultAddress,
      priceLevel: edge.node.tags && edge.node.tags[0] ? edge.node.tags[0].trim() : 'N/A',
    }));

    return customers;
  }

  async searchCustomers(query = '', first = 20, after?: string) {
    const response = await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
          query searchCustomers($first: Int!, $after: String, $query: String) {
            customers(first: $first, after: $after, query: $query) {
              edges {
                cursor
                node {
                  id
                  firstName
                  lastName
                  email
                  addresses {
                    address1
                    address2
                    company
                    city
                    province
                    country
                    zip
                  }
                  defaultAddress {
                    address1
                    company
                    city
                    province
                    country
                    zip
                  }
                  tags
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: {
          first,
          after: after || null,
          query: query.trim() || null,
        },
      },
    });

    const customerConnection = response.data.data.customers;
    const customers = customerConnection.edges.map((edge) => ({
      id: edge.node.id,
      firstName: edge.node.firstName || 'N/A',
      lastName: edge.node.lastName || 'N/A',
      email: edge.node.email || 'N/A',
      addresses: edge.node.addresses.map((address) => ({
        address1: address.address1,
        address2: address.address2,
        company: address.company,
        city: address.city,
        province: address.province,
        country: address.country,
        zip: address.zip,
      })),
      defaultAddress: edge.node.defaultAddress,
      priceLevel: edge.node.tags && edge.node.tags[0] ? edge.node.tags[0].trim() : 'N/A',
    }));

    return {
      customers,
      pageInfo: customerConnection.pageInfo,
    };
  }

  // Get shop customer by ID
  async getCustomerById(id: string) {
    const response = await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
                {
                    customer(id: "${id}") {
                        id
                        firstName
                        lastName
                        addresses {
                            address1
                            address2
                            city
                            province
                            country
                            zip
                        }
                    }
                }
            `,
      },
    });

    return response.data.data.customer;
  }

  // Edit customer company name in default address
  async updateCustomerCompany(id: string, company: string) {
    // chek new line
    try {
      const customerIdFormatted = id.startsWith('gid://shopify/Customer/')
        ? id // Use as-is if already prefixed
        : `gid://shopify/Customer/${id}`; // Add prefix if missing

      const priceLevels = [
        'Price_A',
        'Price_B',
        'price6',
        'price7',
        'price8',
        'test',
        'Price CP',
        'Price_F'
      ];

      // Get default Address ID and existing customer tags
      const data = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            query {
              customer(id: "${customerIdFormatted}") {
                tags
                defaultAddress {
                  id
                }
              }
            }
          `,
        },
      }).then((response) => {
        return {
          defaultAddress: response.data.data.customer.defaultAddress.id,
          tags: response.data.data.customer.tags,
        };
      });

      const currentTags = data.tags || [];
      const filteredTags = currentTags.filter(
        (tag) => !priceLevels.includes(tag.trim()),
      ); // Keep non-price level tags

      // Get price level for company from getCompanyPriceLevel
      const companyPriceLevels = await this.getCompanyPriceLevel();
      for (const [companyName, priceLevel] of Object.entries(
        companyPriceLevels,
      )) {
        if (companyName === company) {
          if (priceLevel && !filteredTags.includes(priceLevel)) {
            filteredTags.push(priceLevel);
          }
        }
      }
      // if (!filteredTags.includes(priceLevel)) {
      //   filteredTags.push(priceLevel);
      // }
      // tags: [${filteredTags.map(tag => `"${tag.trim()}"`).join(', ')}],

      const mutation = `
        mutation {
          customerUpdate(input: {
            id: "${id}",
            tags: [${filteredTags.map((tag) => `"${tag.trim()}"`).join(', ')}],
            addresses: {
              id: "${data.defaultAddress}",
              company: "${company}"
            },
          }) {
            customer {
              id
              firstName
              lastName
              tags
              defaultAddress {
                company
              }
            }
          }
        }
      `;

      const customerCompany = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: { query: mutation },
      }).then((res) => {
        return {
          id: res.data.data.customerUpdate.customer.id,
          firstName: res.data.data.customerUpdate.customer.firstName,
          lastName: res.data.data.customerUpdate.customer.lastName,
          company: res.data.data.customerUpdate.customer.defaultAddress.company,
          priceLevel:
            filteredTags.find((tag) => priceLevels.includes(tag.trim())) ||
            null,
        };
      });

      // Update CompanyCustomerCount
      await this.getCompanyCustomerCount();

      return customerCompany;
    } catch (error) {
      console.error('Error editing customer company:', error.message);
      throw new Error('Failed to edit customer company.' + error.message);
    }
  }

  /** 
   * COMPANY-PRICE LEVEL SERVICES
   */

  // Set company and price level in Shopify metafield. Create if not existing.
  async setCompanyPriceLevel(company: string, priceLevel?: string) {
    try {
      priceLevel = priceLevel || ''; // Default to no tag if not provided

      let mapping = {};

      // Check if metafield exists and get Shop ID
      await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            query {
              shop {
                metafield(namespace: "pricing", key: "price_level_per_company") {
                  id
                  value
                }
              }
            }
          `,
        },
      })
        .then((response) => {
          // Get existing company-priceLevel pairings and replace. Add new company and priceLevel if not existing.
          const metafield = response.data.data.shop.metafield;
          if (metafield && metafield.value) {
            mapping = JSON.parse(metafield.value);
          }
          mapping[company] = priceLevel;
        })
        .catch((error) => {
          console.error('Error fetching shop metafield:', error.message);
        });

      // Check for unlisted companies from all customers and add if not listed
      await this.getCustomers().then((data) => {
        data.forEach((customer) => {
          if (customer.defaultAddress && customer.defaultAddress?.company !== null && customer.defaultAddress?.company !== '' && customer.defaultAddress?.company !== undefined) {
            console.log('chek is company mapped:', mapping.hasOwnProperty(customer.defaultAddress.company));
            if (!mapping.hasOwnProperty(customer.defaultAddress.company)) {
              mapping[customer.defaultAddress.company] = ''; // Default to no price level
              console.log('chek adding unlisted company:', mapping[customer.defaultAddress.company]);
            }
          }
        });
      });

      console.log('chek mapping before mutation:', mapping);

      const mutation = `
        mutation {
          metafieldsSet(metafields: [{
            namespace: "pricing",
            key: "price_level_per_company",
            value: "${this.escapeGraphQLString(JSON.stringify(mapping))}",
            type: "json",
            ownerId: "${this.shopId}"
          }]) {
            metafields {
              id
              namespace
              key
              value
            }
          }
        }
      `;

      return await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: { query: mutation },
      }).then((response) => {
        console.log('chek response after setting company price level:', response.data);
        return response.data.data.metafieldsSet.metafields;
      });
    } catch (error) {
      console.error('Error setting company price level:', error.message);
      throw new Error('Failed to set company price level.');
    }
  }

  // Get company and respective price level from Shopify metafield
  async getCompanyPriceLevel() {
    try {
      return await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            query {
              shop {
                metafield(namespace: "pricing", key: "price_level_per_company") {
                  value
                }
              }
            }
          `,
        },
      }).then((response) => {
        return JSON.parse(response.data.data.shop.metafield.value || '{}');
      });
    } catch (error) {
      console.error('Error fetching company price level:', error.message);
      throw new Error('Failed to fetch company price level.');
    }
  }

  // Delete company from Shopify metafield
  async deleteCompany(company: string) {
    try {
      let mapping = {};
      let shopId = null;
      await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            query {
              shop {
                id
                metafield(namespace: "pricing", key: "price_level_per_company") {
                  id
                  value
                }
              }
            }
          `,
        },
      })
        .then((response) => {
          shopId = response.data.data.shop.id; // Get Shop ID for mutation

          // Get existing company-priceLevel pairings and replace. Add new company and priceLevel if not existing.
          const metafield = response.data.data.shop.metafield;
          if (metafield && metafield.value) {
            mapping = JSON.parse(metafield.value);
          }
          if (company in mapping) {
            delete mapping[company];
          }
        })
        .catch((error) => {
          console.error('Error fetching shop metafield:', error.message);
        });

      const mutation = `
        mutation {
          metafieldsSet(metafields: [{
            namespace: "pricing",
            key: "price_level_per_company",
            value: "${this.escapeGraphQLString(JSON.stringify(mapping))}",
            type: "json",
            ownerId: "${shopId}"
          }]) {
            metafields {
              id
              namespace
              key
              value
            }
          }
        }
      `;

      return await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: { query: mutation },
      }).then((response) => {
        return response.data.data.metafieldsSet.metafields;
      });
    } catch (error) {
      console.error('Error deleting company:', error.message);
      throw new Error('Failed to delete company.');
    }
  }

  /**
   * COMPANY CUSTOMER COUNT SERVICES
   */
  async generateCompanyCustomerCount() {
    let customerCount = {};

    // Grab all existing companies from company price level metafield
    const initialCompanies = await this.getCompanyPriceLevel().then((data) => {
      return Object.keys(data);
    });

    initialCompanies.forEach((company) => {
      customerCount[company.trim()] = 0;
    });

    // Grab companies from customers and count. Add unlisted companies to customerCount
    const customers = await this.getCustomers();

    customers.forEach((customer) => {
      if (customer.defaultAddress?.company) {
        const pointer = customer.defaultAddress.company.trim();
        if (customerCount[pointer]) {
          customerCount[pointer] = customerCount[pointer] + 1;
        } else {
          customerCount[pointer] = 1; // Add unlisted company with count 1
        }
      }
    })

    console.log('chek customerCount after:', customerCount);

    const query = `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            key
            namespace
            value
            createdAt
            updatedAt
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const variables = {
      "metafields": [
        {
          "key": "company_customer_count",
          "namespace": "pricing",
          "ownerId": this.shopId,
          "type": "json",
          "value": JSON.stringify(customerCount)
        }
      ]
    };

    return await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: { query, variables }
    }).then((response) => {
      return response.data.data.metafieldsSet.metafields;
    })

    // const response = await axios({
    //   url: this.shopifyApiUrl,
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-Shopify-Access-Token': this.shopifyAccessToken,
    //   },
    //   data: { query, variables }
    // })
  }

  async getCompanyCustomerCount() {
    return await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
          query {
            shop {
              metafield(namespace: "pricing", key: "company_customer_count") {
                value
              }
            }
          }
        `,
      },
    }).then(response => {
      return JSON.parse(response.data.data.shop.metafield.value || '{}');
    })
  }

  /** 
   * PRODUCT SERVICES
   */

  async getProducts() {
    const response = await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
          {
            products(first: 10) {
              edges {
                node {
                  id
                  title
                  description
                  priceRange {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                    maxVariantPrice {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        `,
      },
    });

    return response.data.data.products.edges.map((edge) => edge.node);
  }

  async getProductDetails(productId: string) {
    const response = await axios({
      url: this.shopifyApiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.shopifyAccessToken,
      },
      data: {
        query: `
          query {
            product(id: "${productId}") {
              variants(first: 1) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        `,
      },
    });

    const product = response.data.data.product;

    if (!product || !product.variants || product.variants.edges.length === 0) {
      throw new Error(`No variants found for product ID: ${productId}`);
    }

    const defaultVariantId = product.variants.edges[0].node.id;
    return { defaultVariantId };
  }

  /** 
   * DRAFT ORDER SERVICES
   */

  // Create a draft order
  async createDraftOrder(
    customerId: string,
    lineItems: LineItemInput[],
    shippingAddress: ShippingAddressInput,
    metafields: MetafieldInput[],
    note: string,
    email: string,
    attributes: Record<string, any> = {},
  ) {
    try {
      const formattedCustomerId = customerId.startsWith(
        'gid://shopify/Customer/',
      )
        ? customerId
        : `gid://shopify/Customer/${customerId}`;

      // 🟢 Extract email from note
      let extractedEmail = 'fatima@ksesuppliers.com';
      const emailMatch = note.match(/email:\s*([^\s,]+)/i);
      if (emailMatch) {
        extractedEmail = emailMatch[1].trim();
      }

      // Escape values
      const safeNote = this.escapeGraphQLString(note);
      const safeEmail = this.escapeGraphQLString(extractedEmail);

      const reformattedLineItems = lineItems.map((item) => {
        console.log(
          'chek originalUnitPrice and originalPrice and variantId:',
          item.originalUnitPrice,
          item.originalPrice,
          item.variantId,
        );
        const hasDiscount =
          item.originalUnitPrice &&
          item.originalUnitPrice > 0 &&
          item.originalUnitPrice !== item.originalPrice;

        return {
          ...item,
          variantId: item.variantId.startsWith('gid://shopify/ProductVariant/')
            ? item.variantId
            : `gid://shopify/ProductVariant/${item.variantId}`,
          ...(hasDiscount
            ? {
              appliedDiscount: {
                value: (
                  (item.originalPrice - item.originalUnitPrice) /
                  100
                ).toFixed(2),
                valueType: 'FIXED_AMOUNT',
                description: 'Custom pricing applied',
              },
            }
            : {}),
        };
      });

      const mutation = `
      mutation {
        draftOrderCreate(input: {
          customerId: "${formattedCustomerId}",
          email: "${safeEmail}",
          note: "${safeNote}",
          lineItems: [
            ${reformattedLineItems
          .map(
            (item) => `
              {
                variantId: "${item.variantId}",
                quantity: ${item.quantity},
                ${item.appliedDiscount
                ? `
                  appliedDiscount: {
                    value: ${item.appliedDiscount.value},
                    valueType: ${item.appliedDiscount.valueType},
                    description: "${this.escapeGraphQLString(item.appliedDiscount.description)}"
                  }`
                : ''
              }
                title: "${this.escapeGraphQLString(item.title || '')}"
              }
            `,
          )
          .join(',')}
          ],
          shippingAddress: {
            address1: "${this.escapeGraphQLString(shippingAddress.address1)}",
            address2: "${this.escapeGraphQLString(shippingAddress.address2 || '')}",
            city: "${this.escapeGraphQLString(shippingAddress.city)}",
            province: "${this.escapeGraphQLString(shippingAddress.province)}",
            country: "${this.escapeGraphQLString(shippingAddress.country)}",
            zip: "${this.escapeGraphQLString(shippingAddress.zip)}"
          },
          metafields: [
            ${metafields
          .map(
            (metafield) => `
              {
                namespace: "${this.escapeGraphQLString(metafield.namespace)}",
                key: "${this.escapeGraphQLString(metafield.key)}",
                value: "${this.escapeGraphQLString(metafield.value)}",
                type: "${this.escapeGraphQLString(metafield.type)}"
              }
            `,
          )
          .join(',')}
          ]
        }) {
          draftOrder {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: { query: mutation },
      });

      const { draftOrderCreate } = response.data.data;

      if (draftOrderCreate.userErrors.length > 0) {
        throw new Error(draftOrderCreate.userErrors[0].message);
      }

      return draftOrderCreate.draftOrder;
    } catch (error) {
      if (error.response) {
        console.error('Error Response Data:', error.response.data);
      }
      console.error('Error creating draft order:', error.message);
      throw new Error('Failed to create draft order.');
    }
  }

  // Create tags for draft orders
  async createDraftOrderTag(
    draftOrderId: string,
    tag: string,
  ): Promise<boolean> {
    try {
      // Ensure the draftOrderId has the correct prefix
      const formattedId = draftOrderId.startsWith('gid://shopify/DraftOrder/')
        ? draftOrderId // Use as-is if already prefixed
        : `gid://shopify/DraftOrder/${draftOrderId}`; // Add prefix if missing

      // Construct REST API URL (Shopify REST API works with numeric IDs, so we clean the ID here)
      const cleanDraftOrderId = formattedId.split('/').pop(); // Extract numeric part of the ID
      const restApiUrl = `${process.env.SHOPIFY_REST_API_URL}/draft_orders/${cleanDraftOrderId}.json`;

      // Fetch the current tags
      const fetchResponse = await axios({
        url: restApiUrl,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
      });

      const currentTags = fetchResponse.data.draft_order.tags
        ? fetchResponse.data.draft_order.tags.split(', ')
        : [];

      // Add the tag if it doesn't already exist
      if (!currentTags.includes(tag)) {
        currentTags.push(tag);
      }

      // Update the tags
      const updateResponse = await axios({
        url: restApiUrl,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
        data: {
          draft_order: {
            tags: currentTags.join(', '),
          },
        },
      });

      // Handle errors returned by Shopify
      if (updateResponse.data.errors) {
        console.error('Shopify API errors:', updateResponse.data.errors);
        throw new Error('Shopify API returned an error');
      }

      console.log('Draft order tags updated successfully:');

      return true;
    } catch (error) {
      console.error(
        'Error updating draft order tags in Shopify:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to update draft order tags in Shopify.');
    }
  }

  async getDraftOrdersPageByCustomerId(
    customerId: string,
    first = 10,
    after?: string,
  ): Promise<DraftOrderPage> {
    const numericCustomerId = customerId.split('/').pop();

    if (!numericCustomerId || !/^\d+$/.test(numericCustomerId)) {
      throw new Error('Invalid Shopify customer ID.');
    }

    const pageSize = Math.min(Math.max(first, 1), 10);
    const query = `
      query GetDraftOrdersPage(
        $first: Int!
        $after: String
        $searchQuery: String!
      ) {
        draftOrders(
          first: $first
          after: $after
          query: $searchQuery
          sortKey: NUMBER
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              customer { id }
              tags
              shippingAddress {
                address1
                city
                province
                country
                zip
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    appliedDiscount {
                      value
                      valueType
                    }
                    variant {
                      title
                      price
                      metafields(first: 5) {
                        nodes {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query,
          variables: {
            first: pageSize,
            after: after || null,
            searchQuery: `customer_id:${numericCustomerId} tag:Placed`,
          },
        },
      });

      if (response.data.errors?.length) {
        throw new Error(
          response.data.errors
            .map((error: { message: string }) => error.message)
            .join('; '),
        );
      }

      const connection = response.data.data?.draftOrders;

      if (!connection?.edges || !connection?.pageInfo) {
        throw new Error('Draft-order page not found in the API response.');
      }

      const orders = connection.edges.map((edge) => {
        const order = edge.node;

        return {
          id: order.id,
          name: order.name,
          createdAt: order.createdAt,
          customer: order.customer ? { id: order.customer.id } : null,
          tags: order.tags || [],
          shippingAddress: order.shippingAddress
            ? {
              address1: order.shippingAddress.address1,
              city: order.shippingAddress.city,
              province: order.shippingAddress.province,
              country: order.shippingAddress.country,
              zip: order.shippingAddress.zip,
            }
            : null,
          lineItems:
            order.lineItems?.edges.map((lineItemEdge) => ({
              title: lineItemEdge.node.title,
              quantity: lineItemEdge.node.quantity,
              appliedDiscount: lineItemEdge.node.appliedDiscount
                ? {
                  value: lineItemEdge.node.appliedDiscount.value,
                  valueType: lineItemEdge.node.appliedDiscount.valueType,
                }
                : null,
              variant: lineItemEdge.node.variant
                ? {
                  title: lineItemEdge.node.variant.title,
                  price: lineItemEdge.node.variant.price,
                  metafields:
                    lineItemEdge.node.variant.metafields?.nodes || [],
                }
                : null,
            })) || [],
        };
      });

      return {
        orders,
        pageInfo: {
          hasNextPage: connection.pageInfo.hasNextPage,
          endCursor: connection.pageInfo.endCursor || null,
        },
      };
    } catch (error) {
      console.error(
        'Error fetching customer draft-order page:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to fetch customer draft-order page.');
    }
  }

  async getSavedDraftOrdersPageByCustomerId(
    customerId: string,
    first = 10,
    after?: string,
  ): Promise<DraftOrderPage> {
    const numericCustomerId = customerId.split('/').pop();

    if (!numericCustomerId || !/^\d+$/.test(numericCustomerId)) {
      throw new Error('Invalid Shopify customer ID.');
    }

    const pageSize = Math.min(Math.max(first, 1), 10);
    const query = `
      query GetSavedDraftOrdersPage(
        $first: Int!
        $after: String
        $searchQuery: String!
      ) {
        draftOrders(
          first: $first
          after: $after
          query: $searchQuery
          sortKey: NUMBER
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              customer { id }
              tags
              shippingAddress {
                address1
                city
                province
                country
                zip
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    appliedDiscount {
                      value
                      valueType
                    }
                    variant {
                      title
                      price
                      metafields(first: 5) {
                        nodes {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query,
          variables: {
            first: pageSize,
            after: after || null,
            searchQuery: `customer_id:${numericCustomerId} -tag:Placed -tag:ShipRequested`,
          },
        },
      });

      if (response.data.errors?.length) {
        throw new Error(
          response.data.errors
            .map((error: { message: string }) => error.message)
            .join('; '),
        );
      }

      const connection = response.data.data?.draftOrders;

      if (!connection?.edges || !connection?.pageInfo) {
        throw new Error('Saved draft-order page not found in the API response.');
      }

      const orders = connection.edges.map((edge) => {
        const order = edge.node;

        return {
          id: order.id,
          name: order.name,
          createdAt: order.createdAt,
          customer: order.customer ? { id: order.customer.id } : null,
          tags: order.tags || [],
          shippingAddress: order.shippingAddress
            ? {
              address1: order.shippingAddress.address1,
              city: order.shippingAddress.city,
              province: order.shippingAddress.province,
              country: order.shippingAddress.country,
              zip: order.shippingAddress.zip,
            }
            : null,
          lineItems:
            order.lineItems?.edges.map((lineItemEdge) => ({
              title: lineItemEdge.node.title,
              quantity: lineItemEdge.node.quantity,
              appliedDiscount: lineItemEdge.node.appliedDiscount
                ? {
                  value: lineItemEdge.node.appliedDiscount.value,
                  valueType: lineItemEdge.node.appliedDiscount.valueType,
                }
                : null,
              variant: lineItemEdge.node.variant
                ? {
                  title: lineItemEdge.node.variant.title,
                  price: lineItemEdge.node.variant.price,
                  metafields:
                    lineItemEdge.node.variant.metafields?.nodes || [],
                }
                : null,
            })) || [],
        };
      });

      return {
        orders,
        pageInfo: {
          hasNextPage: connection.pageInfo.hasNextPage,
          endCursor: connection.pageInfo.endCursor || null,
        },
      };
    } catch (error) {
      console.error(
        'Error fetching saved draft-order page:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to fetch saved draft-order page.');
    }
  }

  async getRequestedShippingDraftOrdersPageByCustomerId(
    customerId: string,
    first = 10,
    after?: string,
  ): Promise<DraftOrderPage> {
    const numericCustomerId = customerId.split('/').pop();

    if (!numericCustomerId || !/^\d+$/.test(numericCustomerId)) {
      throw new Error('Invalid Shopify customer ID.');
    }

    const pageSize = Math.min(Math.max(first, 1), 10);
    const query = `
      query GetRequestedShippingDraftOrdersPage(
        $first: Int!
        $after: String
        $searchQuery: String!
      ) {
        draftOrdersCount(query: $searchQuery) {
          count
        }
        draftOrders(
          first: $first
          after: $after
          query: $searchQuery
          sortKey: NUMBER
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              customer { id }
              tags
              shippingAddress {
                address1
                address2
                city
                province
                country
                zip
              }
              shippingLine {
                title
                price
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    appliedDiscount {
                      value
                      valueType
                    }
                    variant {
                      title
                      price
                      metafields(first: 5) {
                        nodes {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query,
          variables: {
            first: pageSize,
            after: after || null,
            searchQuery: `customer_id:${numericCustomerId} tag:ShipRequested -tag:Placed`,
          },
        },
      });

      if (response.data.errors?.length) {
        throw new Error(
          response.data.errors
            .map((error: { message: string }) => error.message)
            .join('; '),
        );
      }

      const connection = response.data.data?.draftOrders;

      if (!connection?.edges || !connection?.pageInfo) {
        throw new Error(
          'Requested-shipping draft-order page not found in the API response.',
        );
      }

      const orders = connection.edges.map((edge) => {
        const order = edge.node;

        return {
          id: order.id,
          name: order.name,
          createdAt: order.createdAt,
          customer: order.customer ? { id: order.customer.id } : null,
          tags: order.tags || [],
          shippingAddress: order.shippingAddress
            ? {
              address1: order.shippingAddress.address1,
              address2: order.shippingAddress.address2,
              city: order.shippingAddress.city,
              province: order.shippingAddress.province,
              country: order.shippingAddress.country,
              zip: order.shippingAddress.zip,
            }
            : null,
          shippingLine: order.shippingLine
            ? {
              title: order.shippingLine.title,
              price: Number(order.shippingLine.price) || 0,
            }
            : null,
          lineItems:
            order.lineItems?.edges.map((lineItemEdge) => ({
              title: lineItemEdge.node.title,
              quantity: lineItemEdge.node.quantity,
              appliedDiscount: lineItemEdge.node.appliedDiscount
                ? {
                  value: lineItemEdge.node.appliedDiscount.value,
                  valueType: lineItemEdge.node.appliedDiscount.valueType,
                }
                : null,
              variant: lineItemEdge.node.variant
                ? {
                  title: lineItemEdge.node.variant.title,
                  price: lineItemEdge.node.variant.price,
                  metafields:
                    lineItemEdge.node.variant.metafields?.nodes || [],
                }
                : null,
            })) || [],
        };
      });

      return {
        orders,
        pageInfo: {
          hasNextPage: connection.pageInfo.hasNextPage,
          endCursor: connection.pageInfo.endCursor || null,
          totalCount: response.data.data?.draftOrdersCount?.count ?? null,
        },
      };
    } catch (error) {
      console.error(
        'Error fetching requested-shipping draft-order page:',
        error.response?.data || error.message,
      );
      throw new Error(
        'Failed to fetch requested-shipping draft-order page.',
      );
    }
  }

  async getCompanyDraftOrdersPage(
    company: string,
    first = 10,
    after?: string,
    poSearch?: string,
  ): Promise<CompanyDraftOrderPage> {
    const requestedCompany = company?.trim();

    if (!requestedCompany || !this.normalizeCompanyName(requestedCompany)) {
      throw new Error('Company is required.');
    }

    const pageSize = Math.min(Math.max(first, 1), 10);
    let shopifyAfter = this.decodeCompanyOrderCursor(after);
    let lastConsumedEdgeCursor = shopifyAfter;
    let hasMoreOrders = false;
    let scanning = true;
    const orders: DraftOrder[] = [];
    const seenCursors = new Set<string>();

    const query = `
      query GetCompanyDraftOrdersPage(
        $first: Int!
        $after: String
        $searchQuery: String!
      ) {
        draftOrders(
          first: $first
          after: $after
          query: $searchQuery
          sortKey: NUMBER
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            cursor
            node {
              id
              name
              createdAt
              customer { id }
              tags
              shippingAddress {
                address1
                city
                province
                country
                zip
                company
              }
              shippingLine {
                title
                price
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    appliedDiscount {
                      value
                      valueType
                    }
                    variant {
                      title
                      price
                      metafields(first: 5) {
                        nodes {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      while (scanning) {
        const response = await axios({
          url: this.shopifyApiUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.shopifyAccessToken,
          },
          data: {
            query,
            variables: {
              first: 50,
              after: shopifyAfter,
              searchQuery: 'tag:Placed',
            },
          },
        });

        if (response.data.errors?.length) {
          throw new Error(
            response.data.errors
              .map((error: { message: string }) => error.message)
              .join('; '),
          );
        }

        const connection = response.data.data?.draftOrders;

        if (!connection?.edges || !connection?.pageInfo) {
          throw new Error(
            'Company draft-order page not found in the API response.',
          );
        }

        for (let index = 0; index < connection.edges.length; index += 1) {
          const edge = connection.edges[index];

          if (!edge.cursor || seenCursors.has(edge.cursor)) {
            throw new Error('Shopify returned an invalid draft-order cursor.');
          }

          seenCursors.add(edge.cursor);
          lastConsumedEdgeCursor = edge.cursor;
          const order = edge.node;

          if (
            this.orderMatchesCompany(order.tags || [], requestedCompany) &&
            this.orderMatchesPoSearch(order.tags || [], poSearch)
          ) {
            orders.push({
              id: order.id,
              name: order.name,
              createdAt: order.createdAt,
              customer: order.customer ? { id: order.customer.id } : null,
              tags: order.tags || [],
              shippingAddress: order.shippingAddress || null,
              shippingLine: order.shippingLine
                ? {
                  title: order.shippingLine.title,
                  price: Number(order.shippingLine.price) || 0,
                }
                : null,
              lineItems:
                order.lineItems?.edges.map((lineItemEdge) => ({
                  title: lineItemEdge.node.title,
                  quantity: lineItemEdge.node.quantity,
                  appliedDiscount: lineItemEdge.node.appliedDiscount || null,
                  variant: lineItemEdge.node.variant
                    ? {
                      title: lineItemEdge.node.variant.title,
                      price: lineItemEdge.node.variant.price,
                      metafields:
                        lineItemEdge.node.variant.metafields?.nodes || [],
                    }
                    : null,
                })) || [],
            });
          }

          if (orders.length === pageSize) {
            hasMoreOrders =
              index < connection.edges.length - 1 ||
              connection.pageInfo.hasNextPage;
            scanning = false;
            break;
          }
        }

        if (!scanning) break;

        if (!connection.pageInfo.hasNextPage) {
          hasMoreOrders = false;
          break;
        }

        const endCursor = connection.pageInfo.endCursor;
        if (!endCursor || endCursor === shopifyAfter) {
          throw new Error(
            'Shopify reported another draft-order page without a new cursor.',
          );
        }

        shopifyAfter = endCursor;
      }

      return {
        orders,
        pageInfo: {
          hasNextPage: hasMoreOrders,
          endCursor:
            hasMoreOrders && lastConsumedEdgeCursor
              ? this.encodeCompanyOrderCursor(lastConsumedEdgeCursor)
              : null,
        },
      };
    } catch (error) {
      console.error(
        'Error fetching company draft-order page:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to fetch company draft-order page.');
    }
  }

  // Get all draft orders
  async getDraftOrders(): Promise<DraftOrder[]> {
    try {
      const query = `
      query GetDraftOrders($first: Int!, $after: String) {
        draftOrders(
          first: $first
          after: $after
          sortKey: NUMBER
          reverse: false
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              customer {
                id
              }
              tags
              shippingAddress {
                address1
                city
                province
                country
                zip
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    appliedDiscount {
                      value
                      valueType
                    }
                    variant {
                      title
                      price
                      metafields(first: 5) {
                        nodes {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

      const allEdges: any[] = [];
      const seenCursors = new Set<string>();
      let after: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const response = await axios({
          url: this.shopifyApiUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.shopifyAccessToken,
          },
          data: {
            query,
            variables: {
              first: 100,
              after,
            },
          },
        });

        if (response.data.errors?.length) {
          throw new Error(
            response.data.errors
              .map((error: { message: string }) => error.message)
              .join('; '),
          );
        }

        const draftOrders = response.data.data?.draftOrders;

        if (!draftOrders?.edges) {
          throw new Error('Draft orders not found in the API response.');
        }

        allEdges.push(...draftOrders.edges);

        hasNextPage = draftOrders.pageInfo?.hasNextPage ?? false;

        if (hasNextPage) {
          const endCursor = draftOrders.pageInfo?.endCursor;

          if (!endCursor) {
            throw new Error(
              'Shopify reported another draft-order page without an end cursor.',
            );
          }

          if (seenCursors.has(endCursor)) {
            throw new Error(
              'Shopify returned a repeated draft-order pagination cursor.',
            );
          }

          seenCursors.add(endCursor);
          after = endCursor;
        }
      }

      console.log(`Fetched ${allEdges.length} draft orders from Shopify.`);

      return allEdges.map((edge) => {
        const order = edge.node;

        return {
          id: order.id,
          name: order.name,
          createdAt: order.createdAt,
          customer: order.customer ? { id: order.customer.id } : null,
          tags: order.tags || [],
          shippingAddress: order.shippingAddress
            ? {
              address1: order.shippingAddress.address1,
              city: order.shippingAddress.city,
              province: order.shippingAddress.province,
              country: order.shippingAddress.country,
              zip: order.shippingAddress.zip,
            }
            : null,
          lineItems:
            order.lineItems?.edges.map((lineItemEdge) => ({
              title: lineItemEdge.node.title,
              quantity: lineItemEdge.node.quantity,
              appliedDiscount: lineItemEdge.node.appliedDiscount
                ? {
                  value: lineItemEdge.node.appliedDiscount.value,
                  valueType: lineItemEdge.node.appliedDiscount.valueType,
                }
                : null,
              variant: lineItemEdge.node.variant
                ? {
                  title: lineItemEdge.node.variant.title,
                  price: lineItemEdge.node.variant.price,
                  metafields:
                    lineItemEdge.node.variant.metafields?.nodes || [],
                }
                : null,
            })) || [],
        };
      });
    } catch (error) {
      console.error('Error fetching draft orders:', error.message || error);
      throw new Error('Failed to fetch draft orders.');
    }
  }

  async getMyOrdersPage(
    customerId: string,
    after?: string,
    before?: string,
  ): Promise<DraftOrderPage> {
    try {
      const numericCustomerId = customerId
        .replace('gid://shopify/Customer/', '')
        .trim();

      if (!/^\d+$/.test(numericCustomerId)) {
        throw new Error('A valid Shopify customer ID is required.');
      }

      const query = `
        query GetMyOrdersPage(
          $first: Int
          $after: String
          $last: Int
          $before: String
          $searchQuery: String!
        ) {
          draftOrders(
            first: $first
            after: $after
            last: $last
            before: $before
            query: $searchQuery
            sortKey: CREATED_AT
            reverse: true
          ) {
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            edges {
              node {
                id
                name
                createdAt
                customer {
                  id
                }
                tags
                shippingAddress {
                  address1
                  city
                  province
                  country
                  zip
                }
                lineItems(first: 10) {
                  edges {
                    node {
                      title
                      quantity
                      appliedDiscount {
                        value
                        valueType
                      }
                      variant {
                        title
                        price
                        metafields(first: 5) {
                          nodes {
                            key
                            value
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const isPreviousPageRequest = Boolean(before);
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query,
          variables: {
            first: isPreviousPageRequest ? null : 10,
            after: isPreviousPageRequest ? null : after || null,
            last: isPreviousPageRequest ? 10 : null,
            before: isPreviousPageRequest ? before : null,
            searchQuery: `customer_id:${numericCustomerId} tag:Placed`,
          },
        },
      });

      if (response.data.errors?.length) {
        throw new Error(
          response.data.errors
            .map((error: { message: string }) => error.message)
            .join('; '),
        );
      }

      const draftOrders = response.data.data?.draftOrders;
      if (!draftOrders?.edges || !draftOrders.pageInfo) {
        throw new Error('My Orders page was not found in the API response.');
      }

      return {
        orders: draftOrders.edges.map((edge) => {
          const order = edge.node;
          return {
            id: order.id,
            name: order.name,
            createdAt: order.createdAt,
            customer: order.customer ? { id: order.customer.id } : null,
            tags: order.tags || [],
            shippingAddress: order.shippingAddress
              ? {
                address1: order.shippingAddress.address1,
                city: order.shippingAddress.city,
                province: order.shippingAddress.province,
                country: order.shippingAddress.country,
                zip: order.shippingAddress.zip,
              }
              : null,
            lineItems:
              order.lineItems?.edges.map((lineItemEdge) => ({
                title: lineItemEdge.node.title,
                quantity: lineItemEdge.node.quantity,
                appliedDiscount: lineItemEdge.node.appliedDiscount
                  ? {
                    value: lineItemEdge.node.appliedDiscount.value,
                    valueType: lineItemEdge.node.appliedDiscount.valueType,
                  }
                  : null,
                variant: lineItemEdge.node.variant
                  ? {
                    title: lineItemEdge.node.variant.title,
                    price: lineItemEdge.node.variant.price,
                    metafields:
                      lineItemEdge.node.variant.metafields?.nodes || [],
                  }
                  : null,
              })) || [],
          };
        }),
        pageInfo: draftOrders.pageInfo,
      };
    } catch (error) {
      console.error('Error fetching My Orders page:', error.message || error);
      throw new Error('Failed to fetch My Orders page.');
    }
  }

  // Get all draft orders of a customer
  async getCustomerOrderDetails(
    orderId: string,
    customerId: string,
    company?: string,
  ): Promise<DraftOrder> {
    const numericOrderId = orderId.split('/').pop();
    const numericCustomerId = customerId.split('/').pop();

    if (!numericOrderId || !/^\d+$/.test(numericOrderId)) {
      throw new Error('Invalid Shopify order ID.');
    }

    if (!numericCustomerId || !/^\d+$/.test(numericCustomerId)) {
      throw new Error('Invalid Shopify customer ID.');
    }

    const formattedOrderId = orderId.startsWith('gid://shopify/DraftOrder/')
      ? orderId
      : `gid://shopify/DraftOrder/${numericOrderId}`;

    const query = `
      query GetCustomerOrderDetails($id: ID!) {
        draftOrder(id: $id) {
          id
          name
          createdAt
          customer {
            id
          }
          tags
          shippingAddress {
            address1
            city
            province
            country
            zip
          }
          shippingLine {
            title
            price
          }
          lineItems(first: 10) {
            edges {
              node {
                id
                title
                quantity
                appliedDiscount {
                  value
                  valueType
                }
                variant {
                  id
                  title
                  price
                  metafields(first: 5) {
                    nodes {
                      key
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query,
          variables: { id: formattedOrderId },
        },
      });

      if (response.data.errors?.length) {
        throw new Error(
          response.data.errors
            .map((error: { message: string }) => error.message)
            .join('; '),
        );
      }

      const order = response.data.data?.draftOrder;
      const orderTags = order?.tags || [];
      const isPersonalOrder =
        order?.customer?.id === `gid://shopify/Customer/${numericCustomerId}`;
      const isCompanyOrder = Boolean(
        company?.trim() && this.orderMatchesCompany(orderTags, company.trim()),
      );

      if (!order || !orderTags.includes('Placed') || (!isPersonalOrder && !isCompanyOrder)) {
        throw new Error('Order not found or not accessible.');
      }

      return {
        id: order.id,
        name: order.name || null,
        note: order.note || null,
        createdAt: order.createdAt || null,
        customer: order.customer ? { id: order.customer.id } : null,
        tags: orderTags,
        shippingAddress: order.shippingAddress
          ? {
            address1: order.shippingAddress.address1,
            city: order.shippingAddress.city,
            province: order.shippingAddress.province,
            country: order.shippingAddress.country,
            zip: order.shippingAddress.zip,
          }
          : null,
        shippingLine: order.shippingLine
          ? {
            title: order.shippingLine.title,
            price: Number(order.shippingLine.price) || 0,
          }
          : null,
        lineItems:
          order.lineItems?.edges.map((lineItemEdge) => ({
            id: lineItemEdge.node.id,
            title: lineItemEdge.node.title,
            quantity: lineItemEdge.node.quantity,
            appliedDiscount: lineItemEdge.node.appliedDiscount
              ? {
                value: lineItemEdge.node.appliedDiscount.value,
                valueType: lineItemEdge.node.appliedDiscount.valueType,
              }
              : null,
            variant: lineItemEdge.node.variant
              ? {
                id: lineItemEdge.node.variant.id,
                title: lineItemEdge.node.variant.title,
                price: lineItemEdge.node.variant.price,
                metafields: lineItemEdge.node.variant.metafields?.nodes || [],
              }
              : null,
          })) || [],
      };
    } catch (error) {
      if (error.message === 'Order not found or not accessible.') {
        throw error;
      }

      console.error('Error fetching customer order details:', {
        orderId: numericOrderId,
        customerId: numericCustomerId,
        shopifyError: error.response?.data || error.message,
      });

      throw new Error('Failed to fetch customer order details.');
    }
  }

  async getDraftOrderById(id: string): Promise<DraftOrder> {
    try {
      const formattedId = id.startsWith('gid://shopify/DraftOrder/')
        ? id
        : `gid://shopify/DraftOrder/${id}`;

      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
                    query getDraftOrder($id: ID!) {
                        draftOrder(id: $id) {
                            id
                            name
                            invoiceUrl
                            createdAt
                            shippingAddress {
                                address1
                                city
                                province
                                country
                                zip
                            }
                            lineItems(first: 10) {
                                edges {
                                    node {
                                        title
                                        quantity
                                        appliedDiscount {
                                          value
                                          valueType
                                        }
                                        variant {
                                            title
                                            price
                                            metafields(first: 20) {
                                                nodes {
                                                    key
                                                    value
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `,
          variables: { id: formattedId },
        },
      });

      const draftOrder = response.data.data.draftOrder;

      if (!draftOrder) {
        throw new Error(`Draft order with ID ${id} not found.`);
      }

      return {
        id: draftOrder.id,
        name: draftOrder.name ? draftOrder.name : null,
        invoiceUrl: draftOrder.invoiceUrl ? draftOrder.invoiceUrl : null,
        createdAt: draftOrder.createdAt,
        shippingAddress: draftOrder.shippingAddress,
        lineItems: draftOrder.lineItems.edges.map((edge) => ({
          title: edge.node.title,
          quantity: edge.node.quantity,
          appliedDiscount: edge.node.appliedDiscount
            ? {
              value: edge.node.appliedDiscount.value,
              valueType: edge.node.appliedDiscount.valueType,
            }
            : null,
          variant: {
            title: edge.node.variant?.title,
            price: edge.node.variant?.price,
            metafields: edge.node.variant?.metafields?.nodes || [],
          },
        })),
      };
    } catch (error) {
      console.error(
        'Error fetching draft order:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to fetch draft order.');
    }
  }

  // Get details of a draft order
  async getDraftOrderDetails(draftOrderId: string): Promise<any> {
    const numericId = draftOrderId.replace('gid://shopify/DraftOrder/', '');

    const response = await axios.get(
      `${this.shopifyRestUrl2}/admin/api/2024-01/draft_orders/${numericId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': this.shopifyAccessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );

    return response.data.draft_order;
  }

  // Get tags of a draft order
  async getDraftOrderTags(draftOrderId: string): Promise<DraftOrderTag[]> {
    try {
      // Ensure the draftOrderId has the correct prefix
      const formattedId = draftOrderId.startsWith('gid://shopify/DraftOrder/')
        ? draftOrderId // Use as-is if already prefixed
        : `gid://shopify/DraftOrder/${draftOrderId}`; // Add prefix if missing

      // Extract numeric ID for Shopify REST API
      const cleanDraftOrderId = formattedId.split('/').pop(); // Extract numeric part of the ID

      // Construct GraphQL query with cleaned ID
      const graphqlQuery = {
        query: `
              query getDraftOrder($id: ID!) {
                  draftOrder(id: $id) {
                      id
                      tags
                  }
              }
          `,
        variables: { id: formattedId }, // Pass the formatted ID
      };

      // Make the GraphQL API request
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: graphqlQuery,
      });

      // Extract tags or return an empty array
      const tags = response.data.data.draftOrder?.tags || [];
      return tags.map((tag: string) => ({
        id: cleanDraftOrderId,
        draftOrderId: formattedId,
        tag,
      }));
    } catch (error) {
      console.error(
        'Error retrieving draft order tags from Shopify:',
        error.message,
      );
      throw new Error('Failed to retrieve draft order tags from Shopify.');
    }
  }

  // Update a draft order
  validateShippingAddress(shippingAddress: ShippingAddressInput): void {
    const requiredFields = [
      shippingAddress?.firstName,
      shippingAddress?.lastName,
      shippingAddress?.address1,
      shippingAddress?.city,
      shippingAddress?.province,
      shippingAddress?.country,
      shippingAddress?.zip,
    ];

    if (
      requiredFields.some(
        (value) => typeof value !== 'string' || value.trim().length === 0,
      )
    ) {
      throw new Error(
        'All required shipping address fields must be provided.',
      );
    }
  }

  async updateDraftOrder(
    id: string,
    customerId: string,
    lineItems: LineItemInput[],
    metafields: any[],
    shippingAddress: ShippingAddressInput,
  ) {
    this.validateShippingAddress(shippingAddress);

    try {
      const lineItemsWithVariants = lineItems.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      }));

      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
          mutation updateDraftOrder($id: ID!, $input: DraftOrderInput!) {
            draftOrderUpdate(id: $id, input: $input) {
              draftOrder {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
          variables: {
            id: `gid://shopify/DraftOrder/${id}`,
            input: {
              customerId: `gid://shopify/Customer/${customerId}`,
              lineItems: lineItemsWithVariants,
              metafields: metafields,
              shippingAddress: {
                address1: shippingAddress.address1,
                address2: shippingAddress.address2 || '',
                city: shippingAddress.city,
                province: shippingAddress.province,
                country: shippingAddress.country,
                zip: shippingAddress.zip,
                firstName: shippingAddress.firstName || '',
                lastName: shippingAddress.lastName || '',
                company: shippingAddress.company || '',
              },
            },
          },
        },
      });

      const { draftOrderUpdate } = response.data.data;

      if (draftOrderUpdate.userErrors.length > 0) {
        throw new Error(draftOrderUpdate.userErrors[0].message);
      }

      return draftOrderUpdate.draftOrder;
    } catch (error) {
      if (error.response) {
        console.error('Error Status:', error.response.status);
        console.error('Error Data:', error.response.data);
      }
      throw new Error('Failed to update draft order.');
    }
  }

  // Update draft order shipping address
  async updateDraftOrderAddress(
    draftOrderId: string,
    shippingAddress: ShippingAddressInput,
    email: string,
  ) {
    this.validateShippingAddress(shippingAddress);

    // Ensure the draftOrderId has the correct format
    const formattedDraftOrderId = draftOrderId.startsWith(
      'gid://shopify/DraftOrder/',
    )
      ? draftOrderId // Use as-is if it's already prefixed
      : `gid://shopify/DraftOrder/${draftOrderId}`; // Add prefix if it's missing

    const mutation = `
      mutation {
        draftOrderUpdate(id: "${formattedDraftOrderId}", input: {
          email: "${email}",
          shippingAddress: {
            firstName: "${shippingAddress.firstName}",
            lastName: "${shippingAddress.lastName}",
            address1: "${shippingAddress.address1}",
            address2: "${shippingAddress.address2 || ''}",
            city: "${shippingAddress.city}",
            province: "${shippingAddress.province}",
            company: "${shippingAddress.company}",
            country: "${shippingAddress.country}",
            zip: "${shippingAddress.zip}"
          }
        }) {
          draftOrder {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response = await axios.post(
        this.shopifyApiUrl,
        { query: mutation },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.shopifyAccessToken,
          },
        },
      );

      const data = response.data;
      if (data.errors || data.data.draftOrderUpdate.userErrors.length > 0) {
        console.error(
          'Error updating draft order address:',
          data.errors || data.data.draftOrderUpdate.userErrors,
        );
        throw new Error('Failed to update draft order address.');
      }
    } catch (error) {
      console.error('Error in updateDraftOrderAddress:', error.message);
      throw error;
    }
  }

  // Update draft order tag
  async updateDraftOrderTag(
    draftOrderId: string,
    newTag: string,
  ): Promise<DraftOrderTag> {
    try {
      // Get current tags
      const currentTags = await this.getDraftOrderTags(draftOrderId);

      // Update tag list with new tag
      const updatedTags = currentTags.map((tag) =>
        tag.tag === newTag ? tag : { ...tag, tag: newTag },
      );

      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
                    mutation updateDraftOrder($id: ID!, $tags: [String!]) {
                        draftOrderUpdate(id: $id, input: { tags: $tags }) {
                            draftOrder {
                                id
                                tags
                            }
                            userErrors {
                                field
                                message
                            }
                        }
                    }
                `,
          variables: {
            id: `gid://shopify/DraftOrder/${draftOrderId}`,
            tags: updatedTags.map((tag) => tag.tag),
          },
        },
      });

      const draftOrder = response.data.data?.draftOrderUpdate?.draftOrder;
      if (!draftOrder) throw new Error('Failed to update tags in Shopify.');

      return { id: draftOrderId, draftOrderId, tag: newTag };
    } catch (error) {
      console.error(
        'Error updating draft order tag in Shopify:',
        error.message,
      );
      throw new Error('Failed to update draft order tag in Shopify.');
    }
  }

  // Update draft order note
  async updateDraftOrderNote(
    draftOrderId: string,
    jobCode: string,
  ): Promise<boolean> {
    const draftOrderIdFormatted = draftOrderId.startsWith(
      'gid://shopify/DraftOrder/',
    )
      ? draftOrderId
      : `gid://shopify/DraftOrder/${draftOrderId}`;

    const mutation = `
      mutation draftOrderUpdate($input: DraftOrderInput!) {
        draftOrderUpdate(input: $input) {
          draftOrder {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: draftOrderIdFormatted,
        note: `PO: ${jobCode}`,
      },
    };

    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: mutation,
          variables,
        },
      });

      const draftOrderUpdate = response.data?.data?.draftOrderUpdate;

      if (!draftOrderUpdate) {
        console.error(
          'draftOrderUpdate is missing in response:',
          JSON.stringify(response.data, null, 2),
        );
        throw new Error('draftOrderUpdate field missing in Shopify response.');
      }

      const errors = draftOrderUpdate.userErrors;
      if (errors && errors.length > 0) {
        console.error('GraphQL User Errors:', errors);
        throw new Error(errors.map((e) => e.message).join(', '));
      }

      console.log('Draft order note updated successfully:');

      return true;
    } catch (error) {
      console.error('Error updating draft order note:', error.message);
      throw new Error('Failed to update draft order note.');
    }
  }

  // Delete a draft order by draft order ID
  async deleteDraftOrder(id: string) {
    try {
      // Ensure the draft order ID has the correct prefix
      const formattedDraftOrderId = id.startsWith('gid://shopify/DraftOrder/')
        ? id // Use as-is if it's already prefixed
        : `gid://shopify/DraftOrder/${id}`; // Add prefix if it's missing

      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
          mutation draftOrderDelete($input: DraftOrderDeleteInput!) {
            draftOrderDelete(input: $input) {
              deletedId
              userErrors {
                field
                message
              }
            }
          }
        `,
          variables: {
            input: {
              id: formattedDraftOrderId, // Use the formatted ID here
            },
          },
        },
      });

      const { draftOrderDelete } = response.data.data;

      if (draftOrderDelete.userErrors.length > 0) {
        throw new Error(draftOrderDelete.userErrors[0].message);
      }

      return draftOrderDelete.deletedId;
    } catch (error) {
      if (error.response) {
        console.error('Error Status:', error.response.status);
        console.error('Error Data:', error.response.data);
      }
      console.error('Error deleting draft order:', error.message);
      throw new Error('Failed to delete draft order.');
    }
  }

  async calculateDraftOrderById(draftOrderId: string) {
    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            mutation {
              draftOrderCalculate(id: "gid://shopify/DraftOrder/${draftOrderId}") {
                calculatedDraftOrder {
                  lineItems {
                    title
                    quantity
                    discountedTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  totalTaxSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
        },
      });

      const data = response.data.data.draftOrderCalculate.calculatedDraftOrder;

      if (response.data.data.draftOrderCalculate.userErrors.length > 0) {
        console.error(
          'User Errors:',
          response.data.data.draftOrderCalculate.userErrors,
        );
        throw new Error(
          response.data.data.draftOrderCalculate.userErrors[0].message,
        );
      }

      return data;
    } catch (error) {
      console.error('Error in calculating draft order:', error.message);
      if (error.response) {
        console.error('Response Data:', error.response.data);
      }
      throw new Error('Failed to calculate draft order.');
    }
  }

  async completeDraftOrder(id: string) {
    try {
      // Ensure the ID is formatted correctly
      const formattedId = id.startsWith('gid://shopify/DraftOrder/')
        ? id // Use as-is if already prefixed
        : `gid://shopify/DraftOrder/${id}`; // Add prefix if missing

      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            mutation draftOrderComplete($id: ID!) {
              draftOrderComplete(id: $id) {
                draftOrder {
                  id
                  order {
                    id
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            id: formattedId, // Use the validated/constructed ID
          },
        },
      });

      const { data } = response;
      if (data.errors) {
        console.error('Shopify API errors:', data.errors);
        throw new Error(
          data.errors[0]?.message || 'Unknown error from Shopify API',
        );
      }

      const draftOrderComplete = data.data?.draftOrderComplete;
      if (
        draftOrderComplete.userErrors &&
        draftOrderComplete.userErrors.length > 0
      ) {
        throw new Error(draftOrderComplete.userErrors[0].message);
      }

      if (!draftOrderComplete || !draftOrderComplete.draftOrder) {
        throw new Error('Draft order completion failed.');
      }

      return draftOrderComplete.draftOrder;
    } catch (error) {
      console.error('Error completing draft order:', error.message);
      throw new Error('Failed to complete draft order.');
    }
  }

  async isDraftOrderCompleted(id: string): Promise<boolean> {
    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            {
              draftOrder(id: "gid://shopify/DraftOrder/${id}") {
                id
                order {
                  id
                }
              }
            }
          `,
        },
      });

      const draftOrder = response.data.data.draftOrder;
      // If an associated order exists, the draft order is completed
      return draftOrder.order != null;
    } catch (error) {
      console.error('Error checking draft order completion status:', error);
      throw new Error('Failed to check draft order completion status.');
    }
  }

  async fetchData(query: string): Promise<any> {
    try {
      const response = await axios({
        url: this.shopifyApiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: { query },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching data:', error.message);
      throw new Error('Failed to fetch data.');
    }
  }

  async checkForShippingFee(draftOrderId: string): Promise<number> {
    try {
      // Ensure the ID is in the correct format
      const formattedId = draftOrderId.startsWith('gid://shopify/DraftOrder/')
        ? draftOrderId
        : `gid://shopify/DraftOrder/${draftOrderId}`;

      const response = await axios({
        url: this.shopifyApiUrl, // Your Shopify API endpoint
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.shopifyAccessToken,
        },
        data: {
          query: `
            query {
              draftOrder(id: "${formattedId}") {
                id
                shippingLine {
                  title
                  price
                }
              }
            }
          `,
        },
      });

      const draftOrder = response.data.data.draftOrder;

      if (
        draftOrder &&
        draftOrder.shippingLine &&
        draftOrder.shippingLine.price
      ) {
        return parseFloat(draftOrder.shippingLine.price);
      } else {
        return 0; // No shipping fee present
      }
    } catch (error) {
      if (error.response) {
        console.error('Error Status:', error.response.status);
        console.error('Error Data:', error.response.data);
      }
      console.error('Error checking for shipping fee:', error.message);
      throw new Error('Failed to check for shipping fee.');
    }
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async getCombinedDraftOrdersPage(
    customerId: string,
    company: string,
    first = 10,
    after?: string,
    search?: string,
  ): Promise<CompanyDraftOrderPage> {
    const numericCustomerId = customerId.split('/').pop();

    if (!numericCustomerId || !/^\d+$/.test(numericCustomerId)) {
      throw new Error('Invalid Shopify customer ID.');
    }

    const requestedCompany = company?.trim();
    const hasCompany = Boolean(
      requestedCompany && this.normalizeCompanyName(requestedCompany),
    );

    const pageSize = Math.min(Math.max(first, 1), 10);
    let shopifyAfter = this.decodeCompanyOrderCursor(after);
    let lastConsumedEdgeCursor = shopifyAfter;
    let hasMoreOrders = false;
    let scanning = true;
    const orders: DraftOrder[] = [];
    const seenCursors = new Set<string>();

    const query = `
      query GetCombinedDraftOrdersPage(
        $first: Int!
        $after: String
        $searchQuery: String!
      ) {
        draftOrders(
          first: $first
          after: $after
          query: $searchQuery
          sortKey: NUMBER
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            cursor
            node {
              id
              name
              createdAt
              customer { id firstName lastName email }
              note2
              tags
              shippingAddress {
                address1
                address2
                city
                province
                country
                zip
                company
              }
              shippingLine {
                title
                price
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    name
                    sku
                    quantity
                    appliedDiscount {
                      value
                      valueType
                    }
                    variant {
                      title
                      price
                      metafields(first: 5) {
                        nodes {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      while (scanning) {
        const response = await axios({
          url: this.shopifyApiUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.shopifyAccessToken,
          },
          data: {
            query,
            variables: {
              first: 50,
              after: shopifyAfter,
              searchQuery: 'tag:Placed',
            },
          },
        });

        if (response.data.errors?.length) {
          throw new Error(
            response.data.errors
              .map((error: { message: string }) => error.message)
              .join('; '),
          );
        }

        const connection = response.data.data?.draftOrders;

        if (!connection?.edges || !connection?.pageInfo) {
          throw new Error(
            'Combined draft-order page not found in the API response.',
          );
        }

        for (let index = 0; index < connection.edges.length; index += 1) {
          const edge = connection.edges[index];

          if (!edge.cursor || seenCursors.has(edge.cursor)) {
            throw new Error('Shopify returned an invalid draft-order cursor.');
          }

          seenCursors.add(edge.cursor);
          lastConsumedEdgeCursor = edge.cursor;
          const order = edge.node;
          const isPersonalOrder =
            order.customer?.id === `gid://shopify/Customer/${numericCustomerId}`;
          const isCompanyOrder =
            hasCompany &&
            this.orderMatchesCompany(order.tags || [], requestedCompany);

          if (
            (isPersonalOrder || isCompanyOrder) &&
            this.orderMatchesSearch(order, search)
          ) {
            orders.push({
              id: order.id,
              name: order.name,
              createdAt: order.createdAt,
              note: order.note2 || null,
              customer: order.customer
                ? {
                  id: order.customer.id,
                  firstName: order.customer.firstName || null,
                  lastName: order.customer.lastName || null,
                  email: order.customer.email || null,
                }
                : null,
              orderType: isCompanyOrder && !isPersonalOrder ? 'Company' : 'Personal',
              tags: order.tags || [],
              shippingAddress: order.shippingAddress || null,
              shippingLine: order.shippingLine
                ? {
                  title: order.shippingLine.title,
                  price: Number(order.shippingLine.price) || 0,
                }
                : null,
              lineItems:
                order.lineItems?.edges.map((lineItemEdge) => ({
                  title: lineItemEdge.node.title,
                  name: lineItemEdge.node.name || null,
                  sku: lineItemEdge.node.sku || null,
                  quantity: lineItemEdge.node.quantity,
                  appliedDiscount: lineItemEdge.node.appliedDiscount || null,
                  variant: lineItemEdge.node.variant
                    ? {
                      title: lineItemEdge.node.variant.title,
                      price: lineItemEdge.node.variant.price,
                      metafields:
                        lineItemEdge.node.variant.metafields?.nodes || [],
                    }
                    : null,
                })) || [],
            });
          }

          if (orders.length === pageSize) {
            hasMoreOrders =
              index < connection.edges.length - 1 ||
              connection.pageInfo.hasNextPage;
            scanning = false;
            break;
          }
        }

        if (!scanning) break;

        if (!connection.pageInfo.hasNextPage) {
          hasMoreOrders = false;
          break;
        }

        const endCursor = connection.pageInfo.endCursor;
        if (!endCursor || endCursor === shopifyAfter) {
          throw new Error(
            'Shopify reported another draft-order page without a new cursor.',
          );
        }

        shopifyAfter = endCursor;
      }

      return {
        orders,
        pageInfo: {
          hasNextPage: hasMoreOrders,
          endCursor:
            hasMoreOrders && lastConsumedEdgeCursor
              ? this.encodeCompanyOrderCursor(lastConsumedEdgeCursor)
              : null,
        },
      };
    } catch (error) {
      console.error(
        'Error fetching combined draft-order page:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to fetch combined draft-order page.');
    }
  }

  async sendShippingQuoteEmails(
    userId: string,
    draftOrderId: string,
    customerEmail: string,
    shippingAddress: ShippingAddressInput,
  ): Promise<boolean> {
    const numericDraftOrderId = draftOrderId.replace(
      'gid://shopify/DraftOrder/',
      '',
    );
    const draftOrder = await this.getDraftOrderDetails(draftOrderId);
    const customer = draftOrder?.customer || {};
    const lineItems = draftOrder?.line_items || [];
    const currency = this.escapeHtml(draftOrder?.currency || '');
    const orderNumber = this.escapeHtml(
      draftOrder?.name || `#${numericDraftOrderId}`,
    );
    const poNumber =
      String(draftOrder?.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .find((tag) => tag.startsWith('PO:'))
        ?.replace(/^PO:\s*/, '') || 'None';
    const subtotal = parseFloat(
      draftOrder?.subtotal_price || draftOrder?.total_price || '0',
    ).toFixed(2);
    const from = this.configService.get<string>('EMAIL_USER');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      auth: {
        user: from,
        pass: this.configService.get<string>('EMAIL_PASS'),
      },
    });

    const addressHtml = `
      ${this.escapeHtml(shippingAddress.company)}<br>
      ${this.escapeHtml(shippingAddress.firstName)} ${this.escapeHtml(shippingAddress.lastName)}<br>
      ${this.escapeHtml(shippingAddress.address1)}<br>
      ${shippingAddress.address2 ? `${this.escapeHtml(shippingAddress.address2)}<br>` : ''}
      ${this.escapeHtml(shippingAddress.city)}, ${this.escapeHtml(shippingAddress.province)} ${this.escapeHtml(shippingAddress.zip)}<br>
      ${this.escapeHtml(shippingAddress.country)}
    `;
    const productRows = lineItems
      .map((item) => {
        const quantity = Number(item.quantity) || 0;
        const unitPrice = parseFloat(item.price || item.variant?.price || '0');
        const lineTotal = parseFloat(
          item.line_price || String(unitPrice * quantity),
        );
        return `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${this.escapeHtml(item.title)}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">x${quantity}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${unitPrice.toFixed(2)} ${currency} each</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${lineTotal.toFixed(2)} ${currency} total</td>
          </tr>
        `;
      })
      .join('');

    const customerMailOptions = {
      from,
      to: customerEmail,
      subject: `Shipping Quote Request Received - Order ${orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f9f9f9;">
          <h2 style="color: #951828;">Shipping Quote Request Received</h2>
          <p>Hi ${this.escapeHtml(customer.first_name || shippingAddress.firstName)},</p>
          <p>We've received your request for a shipping quote for order <strong>${orderNumber}</strong>.</p>
          <p>Our team will review the shipping details and update your order with the shipping cost. We'll contact you once the quote is ready.</p>
          <h3>Shipping address</h3>
          <p>${addressHtml}</p>
          <h3>Order summary</h3>
          <table style="width: 100%; border-collapse: collapse;"><tbody>${productRows}</tbody></table>
          <p style="text-align: right;"><strong>Order subtotal: ${subtotal} ${currency}</strong></p>
          <p>No payment or further action is required until the shipping quote has been prepared.</p>
          <p>If you have questions, please contact our customer service team.</p>
          <p>Thank you,<br><strong>KSE Supplies</strong></p>
        </div>
      `,
    };
    const internalMailOptions = {
      from,
      to: 'orders@ksesuppliers.com',
      subject: `Shipping Quote Request - Order ${orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f9f9f9;">
          <h2 style="color: #951828;">Shipping Quote Request</h2>
          <p><strong>User ID:</strong> ${this.escapeHtml(userId)}</p>
          <p><strong>Customer:</strong> ${this.escapeHtml(customer.first_name)} ${this.escapeHtml(customer.last_name)} (${this.escapeHtml(customerEmail)})</p>
          <p><strong>Company:</strong> ${this.escapeHtml(shippingAddress.company || 'N/A')}</p>
          <p><strong>PO Number:</strong> ${this.escapeHtml(poNumber)}</p>
          <h3>Shipping address</h3>
          <p>${addressHtml}</p>
          <h3>Order details</h3>
          <table style="width: 100%; border-collapse: collapse;"><tbody>${productRows}</tbody></table>
          <p style="text-align: right;"><strong>Order subtotal: ${subtotal} ${currency}</strong></p>
          <p><a href="https://admin.shopify.com/store/kse-suppliers/draft_orders/${encodeURIComponent(numericDraftOrderId)}">View Draft Order</a></p>
        </div>
      `,
    };

    try {
      await Promise.all([
        transporter.sendMail(customerMailOptions),
        transporter.sendMail(internalMailOptions),
      ]);
      console.log(`Shipping quote emails sent for draft order ${numericDraftOrderId}.`);
      return true;
    } catch (error) {
      const mailError = error as Error & {
        code?: string;
        command?: string;
        responseCode?: number;
        response?: string;
      };
      console.error(
        `Failed to send shipping quote emails for draft order ${numericDraftOrderId}.`,
        {
          message: mailError.message,
          code: mailError.code,
          command: mailError.command,
          responseCode: mailError.responseCode,
          response: mailError.response,
        },
      );
      throw new Error('Failed to send shipping quote emails.');
    }
  }

  async placeOrderEmail(userId: string, draftOrderId: string) {
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or another email provider
      auth: {
        user: process.env.EMAIL_USER, // email account username
        pass: process.env.EMAIL_PASS, // email account password
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'orders@ksesuppliers.com',
      subject: `Request Shipping Fee: ${draftOrderId}`,
      html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f9f9f9;">
      <h2 style="color: #951828;">Place Order Request</h2>
      <p><strong>User ID:</strong> ${userId}</p>
      <p><strong>Draft Order ID:</strong> ${draftOrderId}</p>
      <p>The user has requested to place this draft order.</p>
      <p style="margin-top: 20px;">
        <a href="https://admin.shopify.com/store/kse-suppliers/draft_orders/${draftOrderId}" 
           style="display: inline-block; padding: 10px 15px; background-color: #951828; color: white; text-decoration: none; border-radius: 4px;">
          View Draft Order
        </a>
      </p>
    </div>
  `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Shipping request email sent successfully.');
      return { success: true, message: 'Email sent successfully' };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send shipping request email.');
    }
  }

  async sendDraftOrderInvoice(draftOrderId) {
    try {
      const formattedDraftOrderId = draftOrderId.startsWith('gid://shopify/DraftOrder/')
        ? draftOrderId
        : `gid://shopify/DraftOrder/${draftOrderId}`;

      const mutation = `
        mutation {
          draftOrderInvoiceSend(id: "${formattedDraftOrderId}") {
            draftOrder {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const response = await axios({
        url: this.shopifyApiUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.shopifyAccessToken,
        },
        data: { query: mutation },
      });

      console.log("Invoice Send Response:", response.data);

      const result = response.data.data.draftOrderInvoiceSend;

      if (result.userErrors.length > 0) {
        throw new Error(result.userErrors[0].message);
      }

      return true;
    } catch (error) {
      console.error("Error sending draft order invoice:", error.message);
      throw new Error("Failed to send draft order invoice. 1" + error.message);
    }
  }
}
