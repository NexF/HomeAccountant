import api from './api';

// ─── 类型定义 ─────────────────────────

export type ImportRowItem = {
  index: number;
  date: string;
  description: string;
  amount: number;
  direction: '支出' | '收入' | '中性交易';
  payment_method: string;
  external_id: string;
  is_duplicate: boolean;
};

export type ImportFilters = {
  directions: string[];
  payment_methods: string[];
};

export type ImportSummary = {
  income_count: number;
  income_total: number;
  expense_count: number;
  expense_total: number;
  neutral_count: number;
  neutral_total: number;
  duplicate_count: number;
};

export type ImportUploadResponse = {
  task_id: string;
  format: string;
  total_rows: number;
  rows: ImportRowItem[];
  filters: ImportFilters;
  summary: ImportSummary;
  status: string;
};

export type ImportConfirmEntryGroup = {
  indexes: number[];
  expense_account_id: string | null;
  income_account_id: string | null;
  payment_account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
};

export type ImportConfirmRequest = {
  entries: ImportConfirmEntryGroup[];
};

export type ImportConfirmResponse = {
  task_id: string;
  status: string;
  imported_rows: number;
  skipped_rows: number;
  total_confirmed: number;
};

export type ImportHistoryItem = {
  id: string;
  format: string;
  original_filename: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  status: string;
  created_at: string;
};

export type ImportDeleteResponse = {
  deleted_count: number;
};

// ─── API 方法 ─────────────────────────

export const importService = {
  upload: (bookId: string, file: FormData) =>
    api.post<ImportUploadResponse>(`/books/${bookId}/import/upload`, file, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    }),

  confirm: (bookId: string, taskId: string, body: ImportConfirmRequest) =>
    api.post<ImportConfirmResponse>(
      `/books/${bookId}/import/${taskId}/confirm`,
      body
    ),

  history: (bookId: string) =>
    api.get<ImportHistoryItem[]>(`/books/${bookId}/import/history`),

  delete: (bookId: string, taskId: string) =>
    api.delete<ImportDeleteResponse>(`/books/${bookId}/import/${taskId}`),
};
