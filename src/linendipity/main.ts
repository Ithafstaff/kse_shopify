import { NestFactory } from '@nestjs/core';
import { LinendipityModule } from './linendipity.module';

export async function bootstrapLinendipity(): Promise<void> {
  const app = await NestFactory.create(LinendipityModule);
  const developmentOrigin = process.env.LINENDIPITY_DEVELOPMENT_ORIGIN?.trim();

  if (developmentOrigin) {
    app.enableCors({ origin: developmentOrigin });
  }

  await app.listen(Number(process.env.PORT) || 3000);
}

if (require.main === module) {
  void bootstrapLinendipity();
}
