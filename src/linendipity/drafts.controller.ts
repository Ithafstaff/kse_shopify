import {
  Body,
  Controller,
  HttpException,
  Post,
  Query,
} from '@nestjs/common';
import {
  AppProxyAuthError,
  AppProxyAuthService,
  AppProxyQuery,
} from './app-proxy-auth.service';
import {
  DraftOrderError,
  DraftOrderService,
  normalizeDraftRequest,
} from './draft-order.service';

@Controller('proxy/drafts')
export class DraftsController {
  constructor(
    private readonly auth: AppProxyAuthService,
    private readonly drafts: DraftOrderService,
  ) {}

  @Post()
  async create(
    @Query() query: AppProxyQuery,
    @Body() body: unknown,
  ): Promise<{ ok: true; draft: { id: string; name: string } }> {
    try {
      const context = await this.auth.authenticate(query);
      const draft = await this.drafts.createDraft(
        context,
        normalizeDraftRequest(body),
      );
      return { ok: true, draft };
    } catch (error) {
      if (error instanceof AppProxyAuthError || error instanceof DraftOrderError) {
        throw new HttpException(
          { ok: false, code: error.code, message: error.message },
          error.status,
        );
      }
      throw new HttpException(
        {
          ok: false,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Draft orders are temporarily unavailable.',
        },
        503,
      );
    }
  }
}
