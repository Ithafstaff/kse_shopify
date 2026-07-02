import { Field, ObjectType } from '@nestjs/graphql';
import { ShippingAddress } from './shipping-address.module';

@ObjectType()
export class Metafield {
  @Field()
  id: string;

  @Field()
  namespace: string;

  @Field()
  key: string;

  @Field()
  value: string;
}

@ObjectType()
export class TaxLine {
  @Field()
  title: string;

  @Field()
  source: string;

  @Field()
  rate: number;

  @Field()
  ratePercentage: number;
}

@ObjectType()
export class Money {
  @Field()
  amount: string;

  @Field()
  currencyCode: string;
}

@ObjectType()
export class ShippingLine {
  @Field({ nullable: true })
  id?: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  carrierIdentifier?: string;

  @Field({ nullable: true })
  custom?: boolean;

  @Field({ nullable: true })
  code?: string;

  @Field({ nullable: true })
  deliveryCategory?: string;

  @Field({ nullable: true })
  price?: number;
}

@ObjectType()
export class Variant {
  @Field({ nullable: true })
  id?: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  price?: number;

  @Field(() => [Metafield], { nullable: true })
  metafields?: Metafield[];
}

@ObjectType()
export class AppliedDiscount {
  @Field()
  value: number;

  @Field()
  valueType: string;
}


@ObjectType()
export class LineItem {
  @Field()
  id: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  name?: string;

  @Field()
  quantity: number;

  @Field(() => Variant, { nullable: true })
  variant?: Variant;

  @Field(() => AppliedDiscount, { nullable: true })
  appliedDiscount?: AppliedDiscount;

  @Field({ nullable: true })
  sku?: string;

  @Field({ nullable: true })
  vendor?: string;

  @Field({ nullable: true })
  requiresShipping?: boolean;

  @Field(() => [TaxLine], { nullable: true })
  taxLines?: TaxLine[];

}

@ObjectType()
export class Company {
  @Field({ nullable: true })
  id?: string;

  @Field({ nullable: true })
  name?: string;
}

@ObjectType()
export class CompanyContactProfiles {
  @Field(() => Company, { nullable: true })
  company?: Company;
}

@ObjectType()
export class Customer {
  @Field({ nullable: true })
  id: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field(() => [CompanyContactProfiles], { nullable: true })
  companyContactProfiles?: CompanyContactProfiles[];
}



@ObjectType()
export class DraftOrder {
  @Field()
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  note?: string;

  @Field({ nullable: true })
  createdAt?: string;

  @Field({ nullable: true })
  updatedAt?: string;

  @Field({ nullable: true })
  completedAt?: string;

  @Field({ nullable: true })
  status?: string;

  @Field({ nullable: true })
  taxesIncluded?: boolean;

  @Field(() => [LineItem], { nullable: true })
  lineItems?: LineItem[];

  @Field(() => ShippingAddress, { nullable: true })
  shippingAddress?: ShippingAddress;

  @Field(() => ShippingLine, { nullable: true })
  shippingLine?: ShippingLine;

  @Field(() => [TaxLine], { nullable: true })
  taxLines?: TaxLine[];

  @Field(() => Customer, { nullable: true })
  customer?: Customer;

  @Field({ nullable: true })
  invoiceUrl?: string;

  @Field(() => [String], { nullable: true })
  tags?: string[];
}

@ObjectType()
export class DraftOrderPageInfo {
  @Field()
  hasNextPage: boolean;

  @Field({ nullable: true })
  endCursor?: string;
}

@ObjectType()
export class DraftOrderPage {
  @Field(() => [DraftOrder])
  orders: DraftOrder[];

  @Field(() => DraftOrderPageInfo)
  pageInfo: DraftOrderPageInfo;
}

@ObjectType()
export class CompanyDraftOrderPageInfo {
  @Field()
  hasNextPage: boolean;

  @Field({ nullable: true })
  endCursor?: string;
}

@ObjectType()
export class CompanyDraftOrderPage {
  @Field(() => [DraftOrder])
  orders: DraftOrder[];

  @Field(() => CompanyDraftOrderPageInfo)
  pageInfo: CompanyDraftOrderPageInfo;
}
