import axios from 'axios';
import { Platform } from 'react-native';

const getBaseURL = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
};

const api = axios.create({
  baseURL: getBaseURL(),
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 响应拦截器：401 时清除认证状态
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // 延迟引入避免循环依赖
      const { useAuthStore } = await import('@/stores/authStore');
      const { isAuthenticated } = useAuthStore.getState();
      if (isAuthenticated) {
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

/** 健康检查 */
export const healthCheck = () => api.get('/health');

export default api;
