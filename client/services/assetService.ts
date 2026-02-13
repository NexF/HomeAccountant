import api from './api';

export type AssetCreateParams = {
  name: string;
  account_id: string;
  purchase_date: string; // YYYY-MM-DD
  original_cost: number;
  residual_rate?: number;
  useful_life_months: number;
  depreciation_method?: string;
  depreciation_granularity?: string;
};

export type AssetUpdateParams = {
  name?: string;
  residual_rate?: number;
  useful_life_months?: number;
  depreciation_method?: string;
  depreciation_granularity?: string;
};

export type AssetResponse = {
  id: string;
  book_id: string;
  account_id: string;
  account_name: string;
  name: string;
  purchase_date: string;
  original_cost: number;
  residual_rate: number;
  useful_life_months: number;
  depreciation_method: string;
  depreciation_granularity: string;
  accumulated_depreciation: number;
  net_book_value: number;
  period_depreciation: number;
  remaining_months: number;
  depreciation_percentage: number;
  status: string;
  created_at: string;
};

export type AssetDisposeParams = {
  disposal_income: number;
  disposal_date: string;
  income_account_id: string;
};

export type AssetSummary = {
  total_original_cost: number;
  total_accumulated_depreciation: number;
  total_net_book_value: number;
  asset_count: number;
  active_count: number;
};

export type DepreciationRecord = {
  period: string;
  amount: number;
  accumulated: number;
  net_value: number;
  entry_id: string | null;
};

export const assetService = {
  listAssets: (bookId: string, status?: string) =>
    api.get<AssetResponse[]>(`/books/${bookId}/assets`, {
      params: status ? { status } : undefined,
    }),

  getAsset: (assetId: string) =>
    api.get<AssetResponse>(`/assets/${assetId}`),

  createAsset: (bookId: string, params: AssetCreateParams) =>
    api.post<AssetResponse>(`/books/${bookId}/assets`, params),

  updateAsset: (assetId: string, params: AssetUpdateParams) =>
    api.put<AssetResponse>(`/assets/${assetId}`, params),

  deleteAsset: (assetId: string) =>
    api.delete(`/assets/${assetId}`),

  depreciate: (assetId: string, period?: string) =>
    api.post<{ message: string; entry_id: string; asset: AssetResponse }>(
      `/assets/${assetId}/depreciate`,
      null,
      { params: period ? { period } : undefined }
    ),

  dispose: (assetId: string, params: AssetDisposeParams) =>
    api.post<{ message: string; entry_id: string; asset: AssetResponse }>(
      `/assets/${assetId}/dispose`,
      params
    ),

  getDepreciationHistory: (assetId: string) =>
    api.get<DepreciationRecord[]>(`/assets/${assetId}/depreciation-history`),

  getSummary: (bookId: string) =>
    api.get<AssetSummary>(`/books/${bookId}/assets/summary`),
};
