/* 欄位設定 —— 桌機表格與手機卡片共用同一份定義。
   新增欄位只要在這裡加一筆，兩種版面都會跟著長出來；
   數值欄位設 sortable 就會自動有排序表頭與排序選項。 */

import type { NumericKey } from '../types';

export interface ColumnDef {
  key: string;
  label: string;
  /** 只有數值欄位可排序，且 key 必須是 NumericKey */
  sortable?: boolean;
  /** 手機卡片上是否顯示欄名（四個數字要，代號名稱不用） */
  showLabelOnCard?: boolean;
  align?: 'left' | 'right';
}

export const NUMERIC_COLUMNS: Array<{ key: NumericKey; label: string }> = [
  { key: 'yield', label: '殖利率' },
  { key: 'r3', label: '近3月' },
  { key: 'r6', label: '近6月' },
  { key: 'r12', label: '近1年' },
  { key: 'r36', label: '近3年' },
];

export const COLUMNS: ColumnDef[] = [
  { key: 'fav', label: '', align: 'left' },
  { key: 'code', label: '代號' },
  { key: 'name', label: '名稱' },
  { key: 'cust', label: '保管銀行' },
  { key: 'freq', label: '配息' },
  ...NUMERIC_COLUMNS.map(c => ({
    key: c.key, label: c.label, sortable: true, showLabelOnCard: true, align: 'right' as const,
  })),
  { key: 'detail', label: '詳情' },
];
