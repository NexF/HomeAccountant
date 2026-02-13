import { create } from 'zustand';
import {
  loanService,
  type LoanResponse,
  type LoanSummary,
} from '@/services/loanService';

type LoanState = {
  loans: LoanResponse[];
  summary: LoanSummary | null;
  isLoading: boolean;
  filterStatus: string | null;

  fetchLoans: (bookId: string) => Promise<void>;
  fetchSummary: (bookId: string) => Promise<void>;
  setFilterStatus: (status: string | null) => void;
  reset: () => void;
};

export const useLoanStore = create<LoanState>((set, get) => ({
  loans: [],
  summary: null,
  isLoading: false,
  filterStatus: null,

  fetchLoans: async (bookId) => {
    set({ isLoading: true });
    try {
      const status = get().filterStatus;
      const { data } = await loanService.listLoans(bookId, status ?? undefined);
      set({ loans: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchSummary: async (bookId) => {
    try {
      const { data } = await loanService.getSummary(bookId);
      set({ summary: data });
    } catch {
      // ignore
    }
  },

  setFilterStatus: (status) => set({ filterStatus: status }),

  reset: () =>
    set({
      loans: [],
      summary: null,
      isLoading: false,
      filterStatus: null,
    }),
}));
