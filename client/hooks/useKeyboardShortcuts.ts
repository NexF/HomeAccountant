import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';

/**
 * Desktop keyboard shortcuts:
 * - N: 新建记账
 * - /: 聚焦搜索 (reserved)
 * - Esc: 返回上一页
 */
export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Ignore when focused on input elements
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        router.push('/entry/new' as any);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        router.back();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);
}
