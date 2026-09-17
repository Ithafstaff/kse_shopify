import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppProxyAuthService } from './app-proxy-auth.service';
import { AuthController } from './auth.controller';
import { DatabaseService } from './database.service';
import { DraftAttemptRepository } from './draft-attempt.repository';
import { DraftOrderService } from './draft-order.service';
import { DraftsController } from './drafts.controller';
import { HealthController } from './health.controller';
import { SessionRepository } from './session.repository';
import { ShopifyService } from './shopify.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, AuthController, DraftsController],
  providers: [
    DatabaseService,
    SessionRepository,
    DraftAttemptRepository,
    ShopifyService,
    AppProxyAuthService,
    DraftOrderService,
  ],
  exports: [
    DatabaseService,
    SessionRepository,
    DraftAttemptRepository,
    ShopifyService,
    AppProxyAuthService,
    DraftOrderService,
  ],
})
export class LinendipityModule {}
