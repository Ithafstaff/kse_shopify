import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppProxyAccountController } from './app-proxy-account.controller';
import { AppService } from './app.service';

describe('AppProxyAccountController', () => {
  let appService: {
    updateCustomerAccountFromAppProxy: jest.Mock;
  };
  let controller: AppProxyAccountController;

  beforeEach(() => {
    appService = {
      updateCustomerAccountFromAppProxy: jest.fn(),
    };
    controller = new AppProxyAccountController(
      appService as unknown as AppService,
    );
  });

  it('delegates account updates with request body and app proxy query params', async () => {
    const body = {
      customerId: 'gid://shopify/Customer/123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engine',
    };
    const query = {
      logged_in_customer_id: '123',
      signature: 'signed',
    };
    const customer = {
      id: 'gid://shopify/Customer/123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engine',
      priceLevel: 'Price_A',
    };
    appService.updateCustomerAccountFromAppProxy.mockResolvedValue(customer);

    await expect(
      controller.updateCustomerAccount(body, query),
    ).resolves.toEqual({
      success: true,
      customer,
    });
    expect(appService.updateCustomerAccountFromAppProxy).toHaveBeenCalledWith(
      body,
      query,
    );
  });

  it('returns unauthorized for failed app proxy identity verification', async () => {
    appService.updateCustomerAccountFromAppProxy.mockRejectedValue(
      new Error('Customer account identity could not be verified.'),
    );

    await expect(
      controller.updateCustomerAccount(
        {
          customerId: 'gid://shopify/Customer/123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company: 'Analytical Engine',
        },
        { signature: 'bad' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    'Invalid current password or account credentials.',
    'Unable to save account details.',
  ])('returns bad request for a safe account input error: %s', async (message) => {
    appService.updateCustomerAccountFromAppProxy.mockRejectedValue(
      new Error(message),
    );

    await expect(
      controller.updateCustomerAccount(
        {
          customerId: 'gid://shopify/Customer/123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company: 'Analytical Engine',
        },
        { signature: 'signed' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a generic internal error for unexpected backend failures', async () => {
    appService.updateCustomerAccountFromAppProxy.mockRejectedValue(
      new Error('Shopify access token leaked into an upstream error.'),
    );

    await expect(
      controller.updateCustomerAccount(
        {
          customerId: 'gid://shopify/Customer/123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company: 'Analytical Engine',
        },
        { signature: 'signed' },
      ),
    ).rejects.toMatchObject({
      constructor: InternalServerErrorException,
      response: {
        message: 'Unable to save account details.',
      },
    });
  });
});
