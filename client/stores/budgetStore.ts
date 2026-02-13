import { create } from 'zustand';
import {
  budgetService,
  type BudgetResponse,
  type BudgetOverview,
} from '@/services/budgetService';

type BudgetState = {
  budgets: BudgetResponse[];
  overview: BudgetOverview | null;
  isLoading: boolean;
  fetchBudgets: (bookId: string) => Promise<void>;
  fetchOverview: (bookId: string) => Promise<void>;
  reset: () => void;
};

export const useBudgetStore = create<BudgetState>((set) => ({
  budgets: [],
  overview: null,
  isLoading: false,

  fetchBudgets: async (bookId: string) => {
    set({ isLoading: true });
    try {
      const { data } = await budgetService.listBudgets(bookId);
      set({ budgets: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchOverview: async (bookId: string) => {
    try {
      const { data } = await budgetService.getOverview(bookId);
      set({ overview: data });
    } catch {
      // ignore
    }
  },

  reset: () => set({ budgets: [], overview: null, isLoading: false }),
}));
