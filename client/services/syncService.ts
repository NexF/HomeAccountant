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
  status: string;  // "balanced" | "reconciled"
};

export const syncService = {
  submitSnapshot: (
    accountId: string,
    externalBalance: number,
    snapshotDate?: string,
    adjustAccountId?: string,
  ) =>
    api.post<SnapshotResponse>(`/accounts/${accountId}/snapshot`, {
      external_balance: externalBalance,
      snapshot_date: snapshotDate || undefined,
      adjust_account_id: adjustAccountId || undefined,
    }),
};
