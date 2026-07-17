import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ShippingAddress GraphQL output contract', () => {
  it('allows missing legacy address values in the read model', () => {
    const schema = readFileSync(join(__dirname, 'schema.gql'), 'utf8');
    const shippingAddressType = schema.match(
      /type ShippingAddress \{[\s\S]*?\n\}/,
    )?.[0];

    expect(shippingAddressType).toBeDefined();
    expect(shippingAddressType).toContain('address1: String');
    expect(shippingAddressType).toContain('address2: String');
    expect(shippingAddressType).toContain('city: String');
    expect(shippingAddressType).toContain('province: String');
    expect(shippingAddressType).toContain('country: String');
    expect(shippingAddressType).toContain('zip: String');
    expect(shippingAddressType).not.toContain('address1: String!');
    expect(shippingAddressType).not.toContain('city: String!');
    expect(shippingAddressType).not.toContain('province: String!');
    expect(shippingAddressType).not.toContain('country: String!');
    expect(shippingAddressType).not.toContain('zip: String!');
  });

  it('exposes optional address line 2 in the shipping input contract', () => {
    const schema = readFileSync(join(__dirname, 'schema.gql'), 'utf8');
    const shippingAddressInput = schema.match(
      /input ShippingAddressInput \{[\s\S]*?\n\}/,
    )?.[0];

    expect(shippingAddressInput).toBeDefined();
    expect(shippingAddressInput).toContain('address2: String');
  });
});
