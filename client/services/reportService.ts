import api from './api';

export type AccountBalanceItem = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  balance_direction: string;
  parent_id: string | null;
  debit_total: number;
  credit_total: number;
  balance: number;
};

export type BalanceSheetResponse = {
  as_of_date: string;
  assets: AccountBalanceItem[];
  liabilities: AccountBalanceItem[];
  equities: AccountBalanceItem[];
  net_income: number;
  total_asset: number;
  total_liability: number;
  total_equity: number;
  adjusted_equity: number;
  is_balanced: boolean;
};

export type IncomeStatementResponse = {
  start_date: string;
  end_date: string;
  incomes: AccountBalanceItem[];
  expenses: AccountBalanceItem[];
  total_income: number;
  total_expense: number;
  net_income: number;
};

export type RecentEntryItem = {
  id: string;
  book_id: string;
  user_id: string;
  entry_date: string;
  entry_type: string;
  description: string | null;
  note: string | null;
  is_balanced: boolean;
  source: string;
  created_at: string | null;
  updated_at: string | null;
  net_worth_impact: number;
};

export type DashboardResponse = {
  net_asset: number;
  prev_net_asset: number;
  net_asset_change: number;
  total_asset: number;
  total_liability: number;
  month_income: number;
  month_expense: number;
  month_net_income: number;
  recent_entries: RecentEntryItem[];
};

export type NetWorthTrendPoint = {
  date: string;
  label: string;
  net_asset: number;
  total_asset: number;
  total_liability: number;
};

export type BreakdownItem = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: number;
  percentage: number;
};

export const reportService = {
  getBalanceSheet: (bookId: string, date?: string) =>
    api.get<BalanceSheetResponse>(`/books/${bookId}/balance-sheet`, {
      params: date ? { date } : undefined,
    }),

  getIncomeStatement: (bookId: string, start: string, end: string) =>
    api.get<IncomeStatementResponse>(`/books/${bookId}/income-statement`, {
      params: { start, end },
    }),

  getDashboard: (bookId: string) =>
    api.get<DashboardResponse>(`/books/${bookId}/dashboard`),

  getNetWorthTrend: (bookId: string, months = 12) =>
    api.get<NetWorthTrendPoint[]>(`/books/${bookId}/net-worth-trend`, {
      params: { months },
    }),

  getExpenseBreakdown: (bookId: string, start: string, end: string) =>
    api.get<BreakdownItem[]>(`/books/${bookId}/expense-breakdown`, {
      params: { start, end },
    }),

  getAssetAllocation: (bookId: string) =>
    api.get<BreakdownItem[]>(`/books/${bookId}/asset-allocation`),
};
