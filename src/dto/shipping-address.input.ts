import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class ShippingAddressInput {
  @Field()
  address1: string;

  @Field({ nullable: true })
  address2?: string;

  @Field()
  city: string;

  @Field()
  province: string;
  
  @Field({ nullable: true })
  company?: string;

  @Field()
  country: string;

  @Field()
  zip: string;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;
}
