import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class ShippingAddress {
  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  address1?: string;

  @Field({ nullable: true })
  address2?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  province?: string;
  
  @Field({ nullable: true })
  company?: string;

  @Field({ nullable: true })
  country?: string;

  @Field({ nullable: true })
  zip?: string;
}
