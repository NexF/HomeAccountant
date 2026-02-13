import { create } from 'zustand';
import {
  entryService,
  type EntryResponse,
  type EntryDetailResponse,
  type ListEntriesParams,
} from '@/services/entryService';

type EntryState = {
  entries: EntryResponse[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  filterType: string | null;

  fetchEntries: (bookId: string, params?: ListEntriesParams) => Promise<void>;
  loadMore: (bookId: string) => Promise<void>;
  setFilterType: (type: string | null) => void;
  reset: () => void;
};

export const useEntryStore = create<EntryState>((set, get) => ({
  entries: [],
  total: 0,
  page: 1,
  pageSize: 20,
  isLoading: false,
  filterType: null,

  fetchEntries: async (bookId, params) => {
    set({ isLoading: true });
    try {
      const filterType = get().filterType;
      const { data } = await entryService.listEntries(bookId, {
        page: 1,
        page_size: 20,
        entry_type: filterType ?? undefined,
        ...params,
      });
      set({
        entries: data.items,
        total: data.total,
        page: data.page,
        pageSize: data.page_size,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  loadMore: async (bookId) => {
    const { entries, total, page, pageSize, isLoading, filterType } = get();
    if (isLoading || entries.length >= total) return;
    set({ isLoading: true });
    try {
      const { data } = await entryService.listEntries(bookId, {
        page: page + 1,
        page_size: pageSize,
        entry_type: filterType ?? undefined,
      });
      set({
        entries: [...entries, ...data.items],
        total: data.total,
        page: data.page,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  setFilterType: (type) => set({ filterType: type }),

  reset: () =>
    set({
      entries: [],
      total: 0,
      page: 1,
      pageSize: 20,
      isLoading: false,
      filterType: null,
    }),
}));
