export type DraftProperty = { key: string; value: string };

export type DraftSaveItem = {
  variantId: string;
  quantity: number;
  properties?: DraftProperty[];
};

export type DraftSaveRequest = {
  idempotencyKey: string;
  items: DraftSaveItem[];
};
