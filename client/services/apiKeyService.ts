import api from './api';

export type ApiKeyCreateParams = {
  name: string;
  expires_at?: string | null;
};

export type ApiKeyCreateResponse = {
  id: string;
  name: string;
  key: string; // 明文 Key，仅创建时返回
  key_prefix: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
};

export type ApiKeyResponse = {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  plugin_count: number;
};

export type ApiKeyUpdateParams = {
  is_active?: boolean;
  name?: string;
};

export const apiKeyService = {
  create: (params: ApiKeyCreateParams) =>
    api.post<ApiKeyCreateResponse>('/api-keys', params),

  list: () =>
    api.get<ApiKeyResponse[]>('/api-keys'),

  update: (keyId: string, params: ApiKeyUpdateParams) =>
    api.patch<ApiKeyResponse>(`/api-keys/${keyId}`, params),

  delete: (keyId: string) =>
    api.delete(`/api-keys/${keyId}`),
};
