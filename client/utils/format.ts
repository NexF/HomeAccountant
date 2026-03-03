/**
 * 统一金额格式化函数（含隐私遮罩逻辑）
 */

import { usePrivacyStore } from '@/stores/privacyStore';
import Colors from '@/constants/Colors';

const MASK_STANDARD = '¥****.**';
const MASK_WITH_SIGN = '¥****.**';
const MASK_SHORT = '**.**万';
const MASK_AMOUNT = '****.**';

function _fmtCore(v: number): string {
  const abs = Math.abs(v);
  return abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 标准金额：¥1,234.56 / -¥1,234.56 */
export function formatMoney(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_STANDARD;
  const s = _fmtCore(v);
  return v < 0 ? `-¥${s}` : `¥${s}`;
}

/** 带正负号：+¥1,234.56 / -¥1,234.56 / ¥0.00 */
export function formatMoneyWithSign(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_WITH_SIGN;
  const s = _fmtCore(v);
  if (v > 0) return `+¥${s}`;
  if (v < 0) return `-¥${s}`;
  return `¥${s}`;
}

/** 图表 Y 轴短格式：1.2万 / 350 */
export function formatMoneyShort(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_SHORT;
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toFixed(0);
}

/** 纯数字格式（无 ¥ 前缀）：1,234.56 */
export function formatAmount(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_AMOUNT;
  return _fmtCore(v);
}

/**
 * 根据金额正负返回语义颜色
 * @param v      金额数值
 * @param invert 是否反转正负语义（用于费用/负债科目）
 * @returns 颜色字符串
 *
 * 默认模式（invert=false）：
 *   v > 0  → Colors.asset     (#EF4444 红色) — 正向：赚钱/资产增值
 *   v < 0  → Colors.liability (#10B981 绿色) — 负向：亏损/减值
 *   v = 0  → Colors.neutral   (#6B7280 灰色) — 无变化
 *
 * 反转模式（invert=true）：
 *   v > 0  → Colors.liability (#10B981 绿色) — 费用正数=花钱/负债正数=欠钱
 *   v < 0  → Colors.asset     (#EF4444 红色) — 费用负数=退款/负债负数=超额还款
 *   v = 0  → Colors.neutral   (#6B7280 灰色)
 */
export function getAmountColor(v: number, invert?: boolean): string {
  if (v === 0) return Colors.neutral;
  if (invert) {
    return v > 0 ? Colors.liability : Colors.asset;
  }
  return v > 0 ? Colors.asset : Colors.liability;
}
