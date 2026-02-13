import api from './api';

export type UserResponse = {
  id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  currency: string;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type AuthResponse = {
  user: UserResponse;
  token: TokenResponse;
};

export type RegisterParams = {
  email: string;
  password: string;
  nickname?: string;
};

export type LoginParams = {
  email: string;
  password: string;
};

export type ProfileUpdateParams = {
  nickname?: string | null;
  avatar_url?: string | null;
  currency?: string | null;
};

export const authService = {
  register: (params: RegisterParams) =>
    api.post<AuthResponse>('/auth/register', params),

  login: (params: LoginParams) =>
    api.post<AuthResponse>('/auth/login', params),

  getMe: () => api.get<UserResponse>('/auth/me'),

  updateProfile: (params: ProfileUpdateParams) =>
    api.put<UserResponse>('/auth/profile', params),
};
