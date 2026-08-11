import { Module } from '@nestjs/common';
import { ResendMailService } from './resend-mail.service';

@Module({
  providers: [ResendMailService],
  exports: [ResendMailService],
})
export class EmailModule {}
