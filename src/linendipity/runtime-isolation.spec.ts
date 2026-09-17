import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Linendipity runtime isolation', () => {
  it('starts an isolated module without loading the KSE GraphQL application', () => {
    const modulePath = resolve(__dirname, 'linendipity.module.ts');
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    );

    let moduleSource = '';
    try {
      moduleSource = readFileSync(modulePath, 'utf8');
    } catch {
      // The first red run proves the runtime has not been implemented yet.
    }

    expect(moduleSource).toContain('export class LinendipityModule');
    expect(moduleSource).not.toMatch(
      /GraphQLModule|AppResolver|AppModule|EmailModule|AccountRequestModule/,
    );
    expect(packageJson.scripts['start:linendipity:prod']).toBe(
      'node dist/linendipity/main',
    );
  });
});
