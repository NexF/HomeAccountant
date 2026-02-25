import { create } from 'zustand';
import { adminService, setAdminToken } from '@/services/adminService';

type AdminState = {
  adminToken: string | null;
  isAdminAuth: boolean;
  isLoading: boolean;
  error: string | null;

  adminLogin: (password: string) => Promise<void>;
  adminLogout: () => void;
};

export const useAdminStore = create<AdminState>((set) => ({
  adminToken: null,
  isAdminAuth: false,
  isLoading: false,
  error: null,

  adminLogin: async (password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await adminService.login(password);
      setAdminToken(data.admin_token);
      set({ adminToken: data.admin_token, isAdminAuth: true, isLoading: false });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '验证失败';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  adminLogout: () => {
    setAdminToken(null);
    set({ adminToken: null, isAdminAuth: false, error: null });
  },
}));
