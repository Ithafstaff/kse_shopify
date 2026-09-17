import {
  Body,
  Controller,
  Get,
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
  DraftPage,
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

  @Get()
  async list(
    @Query() query: AppProxyQuery & { first?: string; after?: string },
  ): Promise<{ ok: true } & DraftPage> {
    try {
      const context = await this.auth.authenticate(query);
      const page = await this.drafts.listDrafts(context, {
        first: query.first,
        after: query.after,
      });
      return { ok: true, ...page };
    } catch (error) {
      this.rethrowSafe(error);
    }
  }

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
      this.rethrowSafe(error);
    }
  }

  private rethrowSafe(error: unknown): never {
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
