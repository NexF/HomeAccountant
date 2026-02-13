/**
 * 家庭记账 App 色彩体系
 * 资产色（红色） / 负债色（绿色） — 与 A 股涨跌配色一致
 */

const primary = '#4F46E5'; // 靛蓝色，主色调
const assetRed = '#EF4444'; // 红色，资产增长/收入（A股涨色）
const liabilityGreen = '#10B981'; // 绿色，负债/费用（A股跌色）
const neutral = '#6B7280'; // 灰色，中性/转换

export default {
  primary,
  asset: assetRed,
  liability: liabilityGreen,
  neutral,
  light: {
    text: '#1F2937',
    textSecondary: '#6B7280',
    background: '#F9FAFB',
    card: '#FFFFFF',
    border: '#E5E7EB',
    tint: primary,
    tabIconDefault: '#9CA3AF',
    tabIconSelected: primary,
  },
  dark: {
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    background: '#111827',
    card: '#1F2937',
    border: '#374151',
    tint: '#818CF8',
    tabIconDefault: '#6B7280',
    tabIconSelected: '#818CF8',
  },
};
