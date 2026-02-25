import api from './api';

// ---- 类型 ----

export type AdminLoginResponse = {
  admin_token: string;
  expires_in: number;
};

export type AdminStats = {
  total_users: number;
  active_users: number;
  banned_users: number;
  total_books: number;
  personal_books: number;
  family_books: number;
  total_entries: number;
  today_new_users: number;
  today_new_entries: number;
  weekly_active_users: number;
};

export type AdminUserItem = {
  id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  is_active: boolean;
  book_count: number;
  created_at: string;
  last_active_at: string | null;
};

export type AdminBookItem = {
  id: string;
  name: string;
  type: string;
  owner_email: string;
  owner_nickname: string | null;
  member_count: number;
  entry_count: number;
  created_at: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type UserListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  status?: 'active' | 'banned';
};

export type BookListParams = {
  page?: number;
  page_size?: number;
  search?: string;
};

// ---- Admin token 管理（仅内存） ----

let _adminToken: string | null = null;

export function setAdminToken(token: string | null) {
  _adminToken = token;
}

export function getAdminToken(): string | null {
  return _adminToken;
}

function adminHeaders() {
  return _adminToken ? { 'X-Admin-Token': _adminToken } : {};
}

// ---- 服务 ----

export const adminService = {
  login: (password: string) =>
    api.post<AdminLoginResponse>('/admin/login', { password }),

  getStats: () =>
    api.get<AdminStats>('/admin/stats', { headers: adminHeaders() }),

  getUsers: (params?: UserListParams) =>
    api.get<PaginatedResponse<AdminUserItem>>('/admin/users', {
      params,
      headers: adminHeaders(),
    }),

  getUser: (id: string) =>
    api.get<AdminUserItem>(`/admin/users/${id}`, { headers: adminHeaders() }),

  updateUser: (id: string, data: { nickname?: string }) =>
    api.patch<AdminUserItem>(`/admin/users/${id}`, data, {
      headers: adminHeaders(),
    }),

  banUser: (id: string) =>
    api.post<AdminUserItem>(`/admin/users/${id}/ban`, null, {
      headers: adminHeaders(),
    }),

  unbanUser: (id: string) =>
    api.post<AdminUserItem>(`/admin/users/${id}/unban`, null, {
      headers: adminHeaders(),
    }),

  getBooks: (params?: BookListParams) =>
    api.get<PaginatedResponse<AdminBookItem>>('/admin/books', {
      params,
      headers: adminHeaders(),
    }),
};
