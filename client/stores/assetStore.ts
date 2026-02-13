import { create } from 'zustand';
import {
  assetService,
  type AssetResponse,
  type AssetSummary,
} from '@/services/assetService';

type AssetState = {
  assets: AssetResponse[];
  summary: AssetSummary | null;
  isLoading: boolean;
  filterStatus: string | null;

  fetchAssets: (bookId: string) => Promise<void>;
  fetchSummary: (bookId: string) => Promise<void>;
  setFilterStatus: (status: string | null) => void;
  reset: () => void;
};

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: [],
  summary: null,
  isLoading: false,
  filterStatus: null,

  fetchAssets: async (bookId) => {
    set({ isLoading: true });
    try {
      const status = get().filterStatus;
      const { data } = await assetService.listAssets(bookId, status ?? undefined);
      set({ assets: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchSummary: async (bookId) => {
    try {
      const { data } = await assetService.getSummary(bookId);
      set({ summary: data });
    } catch {
      // ignore
    }
  },

  setFilterStatus: (status) => set({ filterStatus: status }),

  reset: () =>
    set({
      assets: [],
      summary: null,
      isLoading: false,
      filterStatus: null,
    }),
}));
