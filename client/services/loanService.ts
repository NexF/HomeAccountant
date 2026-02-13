import api from './api';

export type LoanCreateParams = {
  name: string;
  account_id: string;
  principal: number;
  annual_rate: number;
  total_months: number;
  repayment_method?: 'equal_installment' | 'equal_principal';
  start_date: string; // YYYY-MM-DD
  deposit_account_id?: string; // 放款到资产账户 ID，自动生成借款入账分录
};

export type LoanUpdateParams = {
  name?: string;
  annual_rate?: number;
};

export type LoanResponse = {
  id: string;
  book_id: string;
  account_id: string;
  account_name: string;
  name: string;
  principal: number;
  remaining_principal: number;
  annual_rate: number;
  total_months: number;
  repaid_months: number;
  monthly_payment: number;
  repayment_method: string;
  start_date: string;
  status: string;
  total_interest: number;
  created_at: string;
};

export type LoanSummary = {
  total_principal: number;
  total_remaining: number;
  total_paid_principal: number;
  total_interest_paid: number;
  loan_count: number;
  active_count: number;
};

export type RepaymentScheduleItem = {
  period: number;
  payment_date: string;
  payment: number;
  principal: number;
  interest: number;
  remaining: number;
  is_paid: boolean;
};

export type LoanRepayParams = {
  payment_account_id: string;
  interest_account_id?: string;
  repay_date?: string;
};

export type LoanPrepayParams = {
  amount: number;
  payment_account_id: string;
  interest_account_id?: string;
  prepay_date?: string;
};

export type RepayResponse = {
  entry_id: string;
  remaining_principal: number;
  status: string;
};

export const loanService = {
  listLoans: (bookId: string, status?: string) =>
    api.get<LoanResponse[]>(`/books/${bookId}/loans`, {
      params: status ? { status } : undefined,
    }),

  getLoan: (loanId: string) =>
    api.get<LoanResponse>(`/loans/${loanId}`),

  createLoan: (bookId: string, params: LoanCreateParams) =>
    api.post<LoanResponse>(`/books/${bookId}/loans`, params),

  updateLoan: (loanId: string, params: LoanUpdateParams) =>
    api.put<LoanResponse>(`/loans/${loanId}`, params),

  deleteLoan: (loanId: string) =>
    api.delete(`/loans/${loanId}`),

  getSchedule: (loanId: string) =>
    api.get<RepaymentScheduleItem[]>(`/loans/${loanId}/schedule`),

  repay: (loanId: string, params: LoanRepayParams) =>
    api.post<RepayResponse>(`/loans/${loanId}/repay`, params),

  prepay: (loanId: string, params: LoanPrepayParams) =>
    api.post<RepayResponse>(`/loans/${loanId}/prepay`, params),

  getSummary: (bookId: string) =>
    api.get<LoanSummary>(`/books/${bookId}/loans/summary`),
};
