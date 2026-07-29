import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class AccountRequestInput {
  @Field()
  applicantType: string;

  @Field()
  businessName: string;

  @Field()
  contactName: string;

  @Field()
  phone: string;

  @Field()
  email: string;

  @Field({ nullable: true })
  comments?: string;
}
