import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { DraftAttemptRepository } from './draft-attempt.repository';
import { HealthController } from './health.controller';
import { SessionRepository } from './session.repository';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
  providers: [DatabaseService, SessionRepository, DraftAttemptRepository],
  exports: [DatabaseService, SessionRepository, DraftAttemptRepository],
})
export class LinendipityModule {}
