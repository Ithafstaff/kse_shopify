import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Address {
  @Field({ nullable: true })
  address1: string;

  @Field({ nullable: true })
  address2: string;

  @Field({ nullable: true })
  city: string;

  @Field({ nullable: true })
  company: string;

  @Field({ nullable: true })
  province: string;

  @Field({ nullable: true })
  country: string;

  @Field({ nullable: true })
  zip: string;
}

@ObjectType()
export class User {
  @Field()
  id: string;

  @Field()
  firstName: string;
  
  @Field({ nullable: true }) 
  lastName: string;

  @Field({ nullable: true }) 
  email: string;

  @Field(type => [Address], { nullable: true })
  addresses: Address[];

  @Field(type => Address, { nullable: true })
  defaultAddress: Address;

  @Field({ nullable: true })
  priceLevel: string;
}

@ObjectType()
export class CustomerPageInfo {
  @Field()
  hasNextPage: boolean;

  @Field({ nullable: true })
  endCursor?: string;
}

@ObjectType()
export class CustomerPage {
  @Field(() => [User])
  customers: User[];

  @Field(() => CustomerPageInfo)
  pageInfo: CustomerPageInfo;
}
