import { Module } from '@nestjs/common';
import { AccountRequestResolver } from './account-request.resolver';
import { AccountRequestService } from './account-request.service';
import { GmailMailService } from './gmail-mail.service';

@Module({
  providers: [AccountRequestResolver, AccountRequestService, GmailMailService],
})
export class AccountRequestModule {}
