/**
 * Sprint V5.XVI.9：服装属性槽折叠表单。
 * 用户在 product 缩略图下方按需展开 / 填写 5 个可选字段。
 * 空字符串 onChange 时归一为 undefined，避免后端把空串当作有效约束。
 */
import React from 'react';
import type { GarmentAttrs } from '../types';
import { GARMENT_ATTR_FIELDS } from '../constants';

interface GarmentAttrsFormProps {
  value?: GarmentAttrs;
  onChange: (next: GarmentAttrs) => void;
  compact?: boolean;
}

const GarmentAttrsForm: React.FC<GarmentAttrsFormProps> = ({ value, onChange, compact }) => {
  const current = value ?? {};

  const handleField = (key: keyof GarmentAttrs, raw: string) => {
    const next: GarmentAttrs = { ...current };
    if (raw && raw.trim()) {
      next[key] = raw;
    } else {
      delete next[key];
    }
    onChange(next);
  };

  const filledCount = Object.values(current).filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  ).length;

  return (
    <details className="bg-slate-50 rounded-2xl px-3 py-2 text-xs mt-2" open={!compact}>
      <summary className="cursor-pointer select-none text-slate-700 font-medium">
        + 补充服装细节（可选，提升一致性）
        {filledCount > 0 && (
          <span className="ml-2 text-sky-600">· 已填 {filledCount}/5</span>
        )}
      </summary>
      <div className="mt-2 space-y-1.5">
        {GARMENT_ATTR_FIELDS.map((field) => (
          <label key={field.key} className="flex items-center gap-2">
            <span className="w-10 text-slate-500 shrink-0">{field.label}</span>
            <input
              type="text"
              maxLength={32}
              placeholder={field.placeholder}
              value={current[field.key] ?? ''}
              onChange={(e) => handleField(field.key, e.target.value)}
              className="flex-1 min-w-0 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-400"
            />
          </label>
        ))}
      </div>
    </details>
  );
};

export default GarmentAttrsForm;
