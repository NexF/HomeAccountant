import api from './api';

export type ConfigField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'account_select' | 'secret';
  required?: boolean;
  default?: any;
  description?: string;
  options?: { label: string; value: string }[];
};

export type ConfigSchema = {
  fields: ConfigField[];
};

export type PluginResponse = {
  id: string;
  name: string;
  type: string; // entry | balance | both
  api_key_id: string;
  description: string | null;
  last_sync_at: string | null;
  last_sync_status: string; // idle | running | success | failed
  last_error_message: string | null;
  sync_count: number;
  created_at: string;
  updated_at: string;
  config_schema: ConfigSchema | null;
  config: Record<string, any> | null;
  has_config: boolean;
  is_configured: boolean;
};

export const pluginService = {
  list: () =>
    api.get<PluginResponse[]>('/plugins'),

  get: (pluginId: string) =>
    api.get<PluginResponse>(`/plugins/${pluginId}`),

  delete: (pluginId: string) =>
    api.delete(`/plugins/${pluginId}`),

  updateConfig: (pluginId: string, config: Record<string, any>, bookId?: string) =>
    api.put<PluginResponse>(
      `/plugins/${pluginId}/config${bookId ? `?book_id=${bookId}` : ''}`,
      { config }
    ),
};
