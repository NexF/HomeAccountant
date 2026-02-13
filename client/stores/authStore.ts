import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { authService, type UserResponse, type LoginParams, type RegisterParams } from '@/services/authService';
import api from '@/services/api';

const TOKEN_KEY = 'auth_token';

async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function setStoredToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

async function removeStoredToken(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

type AuthState = {
  user: UserResponse | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;

  initialize: () => Promise<void>;
  login: (params: LoginParams) => Promise<void>;
  register: (params: RegisterParams) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    try {
      const token = await getStoredToken();
      if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const { data: user } = await authService.getMe();
        set({ user, token, isAuthenticated: true, isInitialized: true });
      } else {
        set({ isInitialized: true });
      }
    } catch {
      await removeStoredToken();
      delete api.defaults.headers.common['Authorization'];
      set({ user: null, token: null, isAuthenticated: false, isInitialized: true });
    }
  },

  login: async (params) => {
    set({ isLoading: true });
    try {
      const { data } = await authService.login(params);
      const token = data.token.access_token;
      await setStoredToken(token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      set({ user: data.user, token, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  register: async (params) => {
    set({ isLoading: true });
    try {
      const { data } = await authService.register(params);
      const token = data.token.access_token;
      await setStoredToken(token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      set({ user: data.user, token, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    await removeStoredToken();
    delete api.defaults.headers.common['Authorization'];
    set({ user: null, token: null, isAuthenticated: false });
  },
}));
