import api from './api';

export type SnapshotResponse = {
  snapshot_id: string;
  account_id: string;
  account_name: string;
  account_type: string;
  snapshot_date: string;
  external_balance: number;
  book_balance: number;
  difference: number;
  status: string;
  reconciliation_entry_id: string | null;
};

export type ReconcileLineItem = {
  id: string;
  account_id: string;
  account_name: string | null;
  account_code: string | null;
  account_type: string | null;
  debit_amount: number;
  credit_amount: number;
};

export type ReconcileSnapshotInfo = {
  snapshot_id: string;
  account_id: string;
  snapshot_date: string;
  external_balance: number;
  book_balance: number;
  difference: number;
};

export type PendingReconcileItem = {
  entry_id: string;
  entry_date: string;
  description: string | null;
  lines: ReconcileLineItem[];
  snapshot: ReconcileSnapshotInfo | null;
  created_at: string | null;
};

export type ConfirmResponse = {
  entry_id: string;
  reconciliation_status: string;
  target_account_id: string;
  target_account_name: string;
};

export type SplitResponse = {
  entry_id: string;
  reconciliation_status: string;
  splits_count: number;
};

export type PendingCountResponse = {
  count: number;
};

export const syncService = {
  submitSnapshot: (accountId: string, externalBalance: number, snapshotDate?: string) =>
    api.post<SnapshotResponse>(`/accounts/${accountId}/snapshot`, {
      external_balance: externalBalance,
      snapshot_date: snapshotDate || undefined,
    }),

  getPendingReconciliations: (bookId: string) =>
    api.get<PendingReconcileItem[]>(`/books/${bookId}/pending-reconciliations`),

  getPendingCount: (bookId: string) =>
    api.get<PendingCountResponse>(`/books/${bookId}/pending-count`),

  confirmReconciliation: (entryId: string, targetAccountId: string) =>
    api.put<ConfirmResponse>(`/entries/${entryId}/confirm`, {
      target_account_id: targetAccountId,
    }),

  splitReconciliation: (
    entryId: string,
    splits: { account_id: string; amount: number; description?: string }[],
  ) =>
    api.post<SplitResponse>(`/entries/${entryId}/split`, { splits }),
};
