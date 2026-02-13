import { create } from 'zustand';
import {
  accountService,
  type AccountTreeNode,
  type AccountTreeResponse,
} from '@/services/accountService';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: '资产',
  liability: '负债',
  equity: '权益',
  income: '收入',
  expense: '费用',
};

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
];

type AccountState = {
  tree: AccountTreeResponse | null;
  isLoading: boolean;
  currentBookId: string | null;

  fetchTree: (bookId: string) => Promise<void>;
  /** 获取指定类型的扁平列表（含子科目缩进标记） */
  getFlatList: (type: AccountType) => AccountTreeNode[];
  /** 获取所有科目的扁平列表（按五大类排列） */
  getAllFlat: () => { type: AccountType; label: string; accounts: AccountTreeNode[] }[];
  reset: () => void;
};

function flattenNodes(nodes: AccountTreeNode[]): AccountTreeNode[] {
  const result: AccountTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenNodes(node.children));
    }
  }
  return result;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  tree: null,
  isLoading: false,
  currentBookId: null,

  fetchTree: async (bookId: string) => {
    set({ isLoading: true, currentBookId: bookId });
    try {
      const { data } = await accountService.getAccountTree(bookId);
      set({ tree: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  getFlatList: (type) => {
    const tree = get().tree;
    if (!tree) return [];
    return flattenNodes(tree[type]);
  },

  getAllFlat: () => {
    const tree = get().tree;
    if (!tree) return [];
    return ACCOUNT_TYPE_ORDER.map((type) => ({
      type,
      label: ACCOUNT_TYPE_LABELS[type],
      accounts: flattenNodes(tree[type]),
    }));
  },

  reset: () => set({ tree: null, isLoading: false, currentBookId: null }),
}));
