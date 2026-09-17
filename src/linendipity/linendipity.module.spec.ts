import { TestingModule, Test } from '@nestjs/testing';
import { DraftAttemptRepository } from './draft-attempt.repository';
import { LinendipityModule } from './linendipity.module';
import { SessionRepository } from './session.repository';

describe('LinendipityModule', () => {
  const environment = {
    SHOPIFY_API_KEY: 'test-api-key',
    SHOPIFY_API_SECRET: 'test-api-secret',
    SHOPIFY_APP_URL: 'https://example.test',
    SHOPIFY_SHOP: 'example.myshopify.com',
  };
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [name, value] of Object.entries(environment)) {
      previousEnvironment[name] = process.env[name];
      process.env[name] = value;
    }
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('constructs repositories from the registered database service', async () => {
    let moduleRef: TestingModule | undefined;

    try {
      moduleRef = await Test.createTestingModule({
        imports: [LinendipityModule],
      }).compile();

      expect(moduleRef.get(SessionRepository)).toBeInstanceOf(SessionRepository);
      expect(moduleRef.get(DraftAttemptRepository)).toBeInstanceOf(
        DraftAttemptRepository,
      );
    } finally {
      await moduleRef?.close();
    }
  });
});
