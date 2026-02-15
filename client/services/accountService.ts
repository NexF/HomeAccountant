import api from './api';

export type AccountTreeNode = {
  id: string;
  book_id: string;
  code: string;
  name: string;
  type: string;
  parent_id: string | null;
  balance_direction: 'debit' | 'credit';
  icon: string | null;
  is_system: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  is_leaf: boolean;
  children: AccountTreeNode[];
};

export type AccountTreeResponse = {
  asset: AccountTreeNode[];
  liability: AccountTreeNode[];
  equity: AccountTreeNode[];
  income: AccountTreeNode[];
  expense: AccountTreeNode[];
};

export type AccountResponse = {
  id: string;
  book_id: string;
  code: string;
  name: string;
  type: string;
  parent_id: string | null;
  balance_direction: 'debit' | 'credit';
  icon: string | null;
  is_system: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type MigrationInfo = {
  triggered: boolean;
  fallback_account: { id: string; code: string; name: string } | null;
  migrated_lines_count: number;
  message: string;
};

export type AccountCreateResponse = AccountResponse & {
  migration: MigrationInfo;
};

export type CreateAccountParams = {
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  balance_direction: 'debit' | 'credit';
  parent_id?: string;
  icon?: string;
  sort_order?: number;
};

export type UpdateAccountParams = {
  name?: string;
  icon?: string;
  sort_order?: number;
};

export const accountService = {
  getAccountTree: (bookId: string) =>
    api.get<AccountTreeResponse>(`/books/${bookId}/accounts`),

  createAccount: (bookId: string, params: CreateAccountParams) =>
    api.post<AccountCreateResponse>(`/books/${bookId}/accounts`, params),

  updateAccount: (accountId: string, params: UpdateAccountParams) =>
    api.put<AccountResponse>(`/accounts/${accountId}`, params),

  deactivateAccount: (accountId: string) =>
    api.delete<AccountResponse>(`/accounts/${accountId}`),
};
