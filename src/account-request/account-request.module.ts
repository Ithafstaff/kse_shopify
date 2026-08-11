import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AccountRequestResolver } from './account-request.resolver';
import { AccountRequestService } from './account-request.service';

@Module({
  imports: [EmailModule],
  providers: [AccountRequestResolver, AccountRequestService],
})
export class AccountRequestModule {}
