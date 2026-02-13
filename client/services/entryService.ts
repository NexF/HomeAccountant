import api from './api';

export type EntryType =
  | 'expense'
  | 'income'
  | 'asset_purchase'
  | 'asset_dispose'
  | 'borrow'
  | 'repay'
  | 'transfer'
  | 'manual';

export type JournalLineCreate = {
  account_id: string;
  debit_amount?: number;
  credit_amount?: number;
  description?: string;
};

export type EntryCreateParams = {
  entry_type: EntryType;
  entry_date: string; // YYYY-MM-DD
  description?: string;
  note?: string;

  // 简易模式
  amount?: number;
  category_account_id?: string;
  payment_account_id?: string;
  asset_account_id?: string;
  liability_account_id?: string;
  principal?: number;
  interest?: number;
  from_account_id?: string;
  to_account_id?: string;
  extra_liability_account_id?: string;
  extra_liability_amount?: number;

  // 折旧设置（仅 asset_purchase + 固定资产科目时使用）
  asset_name?: string;
  useful_life_months?: number;
  residual_rate?: number;
  depreciation_method?: string;
  depreciation_granularity?: string;

  // 贷款设置（仅 borrow 类型时可选）
  loan_name?: string;
  annual_rate?: number;
  total_months?: number;
  repayment_method?: string;
  start_date?: string;

  // 手动模式
  lines?: JournalLineCreate[];
};

export type EntryUpdateParams = {
  entry_date?: string;
  description?: string;
  note?: string;
};

export type JournalLineResponse = {
  id: string;
  entry_id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  description: string | null;
  account_name: string | null;
  account_code: string | null;
};

export type EntryResponse = {
  id: string;
  book_id: string;
  user_id: string;
  entry_date: string;
  entry_type: EntryType;
  description: string | null;
  note: string | null;
  is_balanced: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  net_worth_impact: number;
};

export type EntryDetailResponse = EntryResponse & {
  lines: JournalLineResponse[];
  asset_id: string | null;
};

export type EntryListResponse = {
  items: EntryResponse[];
  total: number;
  page: number;
  page_size: number;
};

export type ListEntriesParams = {
  page?: number;
  page_size?: number;
  entry_type?: string;
  start_date?: string;
  end_date?: string;
  account_id?: string;
};

export const entryService = {
  createEntry: (bookId: string, params: EntryCreateParams) =>
    api.post<EntryDetailResponse>(`/books/${bookId}/entries`, params),

  listEntries: (bookId: string, params?: ListEntriesParams) =>
    api.get<EntryListResponse>(`/books/${bookId}/entries`, { params }),

  getEntry: (entryId: string) =>
    api.get<EntryDetailResponse>(`/entries/${entryId}`),

  updateEntry: (entryId: string, params: EntryUpdateParams) =>
    api.put<EntryDetailResponse>(`/entries/${entryId}`, params),

  deleteEntry: (entryId: string) =>
    api.delete(`/entries/${entryId}`),
};
