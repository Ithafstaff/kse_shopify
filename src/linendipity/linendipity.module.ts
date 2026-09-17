import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppProxyAuthService } from './app-proxy-auth.service';
import { AuthController } from './auth.controller';
import { DatabaseService } from './database.service';
import { DraftAttemptRepository } from './draft-attempt.repository';
import { HealthController } from './health.controller';
import { SessionRepository } from './session.repository';
import { ShopifyService } from './shopify.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, AuthController],
  providers: [
    DatabaseService,
    SessionRepository,
    DraftAttemptRepository,
    ShopifyService,
    AppProxyAuthService,
  ],
  exports: [
    DatabaseService,
    SessionRepository,
    DraftAttemptRepository,
    ShopifyService,
    AppProxyAuthService,
  ],
})
export class LinendipityModule {}
