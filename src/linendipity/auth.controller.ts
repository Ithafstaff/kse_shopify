import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ShopifyService } from './shopify.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly shopify: ShopifyService) {}

  @Get()
  async install(
    @Req() request: Request,
    @Res() response: Response,
    @Query('shop') shop = '',
  ): Promise<void> {
    await this.shopify.beginInstall(request, response, shop);
  }

  @Get('callback')
  async callback(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.shopify.completeInstall(request, response);
    response
      .status(200)
      .type('html')
      .send('<!doctype html><title>Linendipity Addresses installed</title><p>Installation complete. You can close this window.</p>');
  }
}
