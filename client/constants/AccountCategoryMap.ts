/**
 * 账户分类 → 科目映射常量表
 * "我的账户"功能使用，将用户可理解的账户类型映射到底层科目体系
 */

export type AccountCategoryKey = 'bank' | 'credit-card' | 'stock';

export type AccountCategory = {
  key: AccountCategoryKey;
  label: string;
  icon: string;
  parentCode: string;
  accountType: 'asset' | 'liability';
  balanceDirection: 'debit' | 'credit';
  addLabel: string;
};

export const ACCOUNT_CATEGORIES: AccountCategory[] = [
  {
    key: 'bank',
    label: '银行卡',
    icon: 'bank',
    parentCode: '1001-02',
    accountType: 'asset',
    balanceDirection: 'debit',
    addLabel: '添加银行卡',
  },
  {
    key: 'credit-card',
    label: '信用卡',
    icon: 'credit-card',
    parentCode: '2001',
    accountType: 'liability',
    balanceDirection: 'credit',
    addLabel: '添加信用卡',
  },
  {
    key: 'stock',
    label: '股票账户',
    icon: 'line-chart',
    parentCode: '1101',
    accountType: 'asset',
    balanceDirection: 'debit',
    addLabel: '添加股票账户',
  },
];
