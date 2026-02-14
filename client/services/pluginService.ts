import api from './api';

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
};

export const pluginService = {
  list: () =>
    api.get<PluginResponse[]>('/plugins'),

  get: (pluginId: string) =>
    api.get<PluginResponse>(`/plugins/${pluginId}`),

  delete: (pluginId: string) =>
    api.delete(`/plugins/${pluginId}`),
};
