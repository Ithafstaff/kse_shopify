import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AccountRequestInput } from './account-request.input';
import { AccountRequestResult } from './account-request.model';
import { AccountRequestService } from './account-request.service';

@Resolver()
export class AccountRequestResolver {
  constructor(private readonly accountRequestService: AccountRequestService) {}

  @Mutation(() => AccountRequestResult)
  async requestAccount(
    @Args('input') input: AccountRequestInput,
  ): Promise<AccountRequestResult> {
    return this.accountRequestService.requestAccount(input);
  }
}
