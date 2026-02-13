import api from './api';

export type BudgetCreateParams = {
  account_id?: string | null;
  amount: number;
  alert_threshold?: number;
};

export type BudgetUpdateParams = {
  amount?: number;
  alert_threshold?: number;
  is_active?: boolean;
};

export type BudgetResponse = {
  id: string;
  book_id: string;
  account_id: string | null;
  account_name: string | null;
  amount: number;
  period: string;
  alert_threshold: number;
  is_active: boolean;
  used_amount: number;
  usage_rate: number;
  remaining: number;
  status: string; // normal / warning / exceeded
  created_at: string;
  updated_at: string;
};

export type BudgetOverview = {
  total_budget: number | null;
  total_used: number;
  total_usage_rate: number | null;
  total_status: string; // normal / warning / exceeded / not_set
  category_budgets: BudgetResponse[];
};

export type BudgetAlert = {
  budget_id: string;
  account_name: string | null;
  budget_amount: number;
  used_amount: number;
  usage_rate: number;
  alert_type: string; // warning / exceeded
  message: string;
};

export type BudgetCheckResult = {
  triggered: boolean;
  alerts: BudgetAlert[];
};

export const budgetService = {
  listBudgets: (bookId: string) =>
    api.get<BudgetResponse[]>(`/books/${bookId}/budgets`),

  getBudget: (budgetId: string) =>
    api.get<BudgetResponse>(`/budgets/${budgetId}`),

  createBudget: (bookId: string, params: BudgetCreateParams) =>
    api.post<BudgetResponse>(`/books/${bookId}/budgets`, params),

  updateBudget: (budgetId: string, params: BudgetUpdateParams) =>
    api.put<BudgetResponse>(`/budgets/${budgetId}`, params),

  deleteBudget: (budgetId: string) =>
    api.delete(`/budgets/${budgetId}`),

  getOverview: (bookId: string) =>
    api.get<BudgetOverview>(`/books/${bookId}/budgets/overview`),

  checkBudget: (bookId: string, accountId: string) =>
    api.post<BudgetCheckResult>(`/books/${bookId}/budgets/check?account_id=${accountId}`),
};
