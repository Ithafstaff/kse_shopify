import { Session } from '@shopify/shopify-api';

describe('Linendipity persistence repositories', () => {
  it('stores and restores a Shopify offline session', async () => {
    const { SessionRepository } = require('./session.repository');
    const session = new Session({
      id: 'offline_hfbaf2-f9.myshopify.com',
      shop: 'hfbaf2-f9.myshopify.com',
      state: 'state',
      isOnline: false,
      scope: 'read_customers,read_draft_orders,write_draft_orders',
      accessToken: 'test-token',
    });
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ payload: session.toObject() }],
      });
    const repository = new SessionRepository({ query });

    await expect(repository.store(session)).resolves.toBe(true);
    const restored = await repository.loadOffline(session.shop);

    expect(restored).toBeInstanceOf(Session);
    expect(restored?.toObject()).toEqual(session.toObject());
  });

  it('claims a new idempotency key exactly once', async () => {
    const { DraftAttemptRepository } = require('./draft-attempt.repository');
    const query = jest.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          status: 'CREATING',
          request_fingerprint: 'fingerprint-a',
          draft_order_gid: null,
          draft_order_name: null,
        },
      ],
    });
    const repository = new DraftAttemptRepository({ query });

    await expect(
      repository.claim(
        'hfbaf2-f9.myshopify.com',
        '123',
        '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        'fingerprint-a',
      ),
    ).resolves.toEqual({ kind: 'claimed' });
  });

  it('replays a completed attempt without claiming it again', async () => {
    const { DraftAttemptRepository } = require('./draft-attempt.repository');
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            status: 'CREATED',
            request_fingerprint: 'fingerprint-a',
            draft_order_gid: 'gid://shopify/DraftOrder/99',
            draft_order_name: '#D99',
          },
        ],
      });
    const repository = new DraftAttemptRepository({ query });

    await expect(
      repository.claim(
        'hfbaf2-f9.myshopify.com',
        '123',
        '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        'fingerprint-a',
      ),
    ).resolves.toEqual({
      kind: 'replay',
      draft: { id: 'gid://shopify/DraftOrder/99', name: '#D99' },
    });
  });

  it('rejects reuse of an idempotency key for different cart contents', async () => {
    const { DraftAttemptRepository, DraftAttemptConflictError } = require(
      './draft-attempt.repository',
    );
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            status: 'CREATING',
            request_fingerprint: 'fingerprint-b',
            draft_order_gid: null,
            draft_order_name: null,
          },
        ],
      });
    const repository = new DraftAttemptRepository({ query });

    await expect(
      repository.claim(
        'hfbaf2-f9.myshopify.com',
        '123',
        '5c0d2a56-f36d-4a40-9d44-b9f0014a9c4f',
        'fingerprint-a',
      ),
    ).rejects.toBeInstanceOf(DraftAttemptConflictError);
  });
});
