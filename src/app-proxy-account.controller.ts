import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AppService } from './app.service';

@Controller('account-details')
export class AppProxyAccountController {
  constructor(private readonly appService: AppService) {}

  @Post()
  async updateCustomerAccount(
    @Body()
    body: {
      customerId: string;
      email?: string;
      currentPassword?: string;
      firstName: string;
      lastName: string;
      company: string;
      newPassword?: string;
    },
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    try {
      const customer = await this.appService.updateCustomerAccountFromAppProxy(
        body,
        query,
      );

      return {
        success: true,
        customer,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to save account details.';

      if (message === 'Customer account identity could not be verified.') {
        throw new UnauthorizedException(message);
      }

      if (
        message === 'Invalid current password or account credentials.' ||
        message === 'Unable to save account details.'
      ) {
        throw new BadRequestException(message);
      }

      throw new InternalServerErrorException(
        'Unable to save account details.',
      );
    }
  }
}
