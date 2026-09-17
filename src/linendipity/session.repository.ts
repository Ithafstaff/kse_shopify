import { Inject, Injectable } from '@nestjs/common';
import { Session } from '@shopify/shopify-api';
import { DatabaseExecutor, DatabaseService } from './database.service';

@Injectable()
export class SessionRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseExecutor,
  ) {}

  async store(session: Session): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO linendipity_shopify_sessions
        (id, shop, state, is_online, scope, expires, access_token, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         shop = EXCLUDED.shop,
         state = EXCLUDED.state,
         is_online = EXCLUDED.is_online,
         scope = EXCLUDED.scope,
         expires = EXCLUDED.expires,
         access_token = EXCLUDED.access_token,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [
        session.id,
        session.shop,
        session.state,
        session.isOnline,
        session.scope || null,
        session.expires || null,
        session.accessToken || null,
        JSON.stringify(session.toObject()),
      ],
    );

    return result.rowCount === 1;
  }

  async loadOffline(shop: string): Promise<Session | null> {
    const result = await this.database.query<{ payload: Record<string, unknown> }>(
      `SELECT payload
         FROM linendipity_shopify_sessions
        WHERE shop = $1 AND is_online = FALSE
        ORDER BY updated_at DESC
        LIMIT 1`,
      [shop],
    );

    if (!result.rowCount) return null;
    return new Session(result.rows[0].payload as ConstructorParameters<typeof Session>[0]);
  }
}
