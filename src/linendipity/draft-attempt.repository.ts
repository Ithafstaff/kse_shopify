import { Injectable } from '@nestjs/common';
import { DatabaseExecutor, DatabaseService } from './database.service';

type AttemptRow = {
  status: 'CREATING' | 'CREATED' | 'FAILED';
  request_fingerprint: string;
  draft_order_gid: string | null;
  draft_order_name: string | null;
};

export type DraftAttemptClaim =
  | { kind: 'claimed' }
  | { kind: 'in_progress' }
  | { kind: 'replay'; draft: { id: string; name: string } };

export class DraftAttemptConflictError extends Error {
  constructor() {
    super('This save key belongs to different cart contents.');
    this.name = 'DraftAttemptConflictError';
  }
}

@Injectable()
export class DraftAttemptRepository {
  constructor(private readonly database: DatabaseService | DatabaseExecutor) {}

  async claim(
    shop: string,
    customerId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<DraftAttemptClaim> {
    const inserted = await this.database.query<AttemptRow>(
      `INSERT INTO linendipity_draft_attempts
        (shop, customer_id, operation_type, idempotency_key, request_fingerprint, status)
       VALUES ($1, $2, 'SAVE_CART_DRAFT', $3, $4, 'CREATING')
       ON CONFLICT (shop, customer_id, operation_type, idempotency_key) DO NOTHING
       RETURNING status, request_fingerprint, draft_order_gid, draft_order_name`,
      [shop, customerId, idempotencyKey, fingerprint],
    );

    if (inserted.rowCount === 1) return { kind: 'claimed' };

    const existing = await this.database.query<AttemptRow>(
      `SELECT status, request_fingerprint, draft_order_gid, draft_order_name
         FROM linendipity_draft_attempts
        WHERE shop = $1
          AND customer_id = $2
          AND operation_type = 'SAVE_CART_DRAFT'
          AND idempotency_key = $3`,
      [shop, customerId, idempotencyKey],
    );
    const attempt = existing.rows[0];

    if (!attempt || attempt.request_fingerprint !== fingerprint) {
      throw new DraftAttemptConflictError();
    }

    if (
      attempt.status === 'CREATED' &&
      attempt.draft_order_gid &&
      attempt.draft_order_name
    ) {
      return {
        kind: 'replay',
        draft: {
          id: attempt.draft_order_gid,
          name: attempt.draft_order_name,
        },
      };
    }

    if (attempt.status === 'FAILED') {
      await this.database.query(
        `UPDATE linendipity_draft_attempts
            SET status = 'CREATING', error_code = NULL, updated_at = NOW()
          WHERE shop = $1
            AND customer_id = $2
            AND operation_type = 'SAVE_CART_DRAFT'
            AND idempotency_key = $3`,
        [shop, customerId, idempotencyKey],
      );
      return { kind: 'claimed' };
    }

    return { kind: 'in_progress' };
  }

  async complete(
    shop: string,
    customerId: string,
    idempotencyKey: string,
    draft: { id: string; name: string },
  ): Promise<void> {
    await this.database.query(
      `UPDATE linendipity_draft_attempts
          SET status = 'CREATED',
              draft_order_gid = $4,
              draft_order_name = $5,
              error_code = NULL,
              updated_at = NOW()
        WHERE shop = $1
          AND customer_id = $2
          AND operation_type = 'SAVE_CART_DRAFT'
          AND idempotency_key = $3`,
      [shop, customerId, idempotencyKey, draft.id, draft.name],
    );
  }

  async fail(
    shop: string,
    customerId: string,
    idempotencyKey: string,
    errorCode: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE linendipity_draft_attempts
          SET status = 'FAILED', error_code = $4, updated_at = NOW()
        WHERE shop = $1
          AND customer_id = $2
          AND operation_type = 'SAVE_CART_DRAFT'
          AND idempotency_key = $3`,
      [shop, customerId, idempotencyKey, errorCode],
    );
  }
}
