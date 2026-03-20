/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useLayoutEffect,
} from 'react';
import {
  LayoutPanelLeft,
  Type,
  Download,
  Palette,
  Lock,
  Unlock,
  Settings2,
  Image as ImageIcon,
  FileCode,
  RotateCcw,
  Shuffle,
  Minus,
  Plus,
  Check,
  Trash2,
  Eye,
  EyeOff,
  ChevronsLeft,
  ChevronsRight,
  ArrowLeft,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as htmlToImage from 'html-to-image';
import download from 'downloadjs';
import {
  LayoutState,
  initialLayoutState,
  PlaneConfig,
  UploadedSvg,
  AppTab,
} from './types';
import xhsLogoRaw from './assets/xhs-logo.svg?raw';

const DOT_COLORS: Record<string, string[]> = {
  '#ffffff': ['#9e76ff', '#dfd9ff', '#ffdf7a', '#985946'],
  '#dfd9ff': ['#9e76ff', '#ffffff', '#ffdf7a', '#985946'],
};

// 颜色硬白名单：保证任何情况下渲染/导出只能使用这 4 个颜色
const GRAPHIC_ALLOWED_COLORS = ['#9e76ff', '#dfd9ff', '#ffdf7a', '#985946'] as const;
type GraphicAllowedColor = (typeof GRAPHIC_ALLOWED_COLORS)[number];

const sanitizeAllowedColor = (c: string, fallback: string) =>
  GRAPHIC_ALLOWED_COLORS.includes(c as GraphicAllowedColor) ? c : fallback;

const sanitizeAllowedColorArray = (
  arr: string[] | undefined,
  fallback: string,
) => {
  const list = Array.isArray(arr) ? arr : [];
  const filtered = list.filter((c) =>
    GRAPHIC_ALLOWED_COLORS.includes(c as GraphicAllowedColor),
  );
  return filtered.length ? filtered : [fallback];
};

const ARTBOARD_W = 1920;
const ARTBOARD_H = 900;
const AREA_A = { x: 50, y: 50, w: 1220, h: 425 } as const;
const AREA_B = { h: 170 } as const; // 底部遮罩区：1920×170（高度固定）
const LOGO_BOX = { w: 126, h: 60 } as const;
const TITLE_GAP_PX = 14;
const MAIN_EN_SIZE_MIN = 150;
const MAIN_EN_SIZE_MAX = 240;
const MAIN_EN_LINE_HEIGHT = 0.9;
const MAIN_ZH_SIZE_MIN = 130;
const MAIN_ZH_SIZE_MAX = 185;
const MAIN_ZH_LINE_HEIGHT = 1.05;
const MAIN_EN_OFFSET_Y = 7; // 英文主标题下移：再 +1px（共 7px）
const SUB1_SIZE_PX = 85;
const SUB2_SIZE_PX = 45;
const SUB1_OFFSET_Y = 5;
const SUB2_OFFSET_Y = -13;

function mapEnToZh(en: number) {
  // 需求点：
  // 150 -> 130
  // 180 -> 150
  // 220 -> 180
  const a1 = { x: 150, y: 130 };
  const a2 = { x: 180, y: 150 };
  const a3 = { x: 220, y: 180 };

  const x = clamp(en, MAIN_EN_SIZE_MIN, MAIN_EN_SIZE_MAX);
  let y: number;
  if (x <= a2.x) {
    const t = (x - a1.x) / (a2.x - a1.x);
    y = a1.y + t * (a2.y - a1.y);
  } else {
    const t = (x - a2.x) / (a3.x - a2.x);
    y = a2.y + t * (a3.y - a2.y);
  }
  return clamp(Math.round(y), MAIN_ZH_SIZE_MIN, MAIN_ZH_SIZE_MAX);
}

function mapZhToEn(zh: number) {
  // mapEnToZh 的近似反函数（分段线性反推）
  // 130 -> 150
  // 150 -> 180
  // 180 -> 220
  const b1 = { x: 130, y: 150 };
  const b2 = { x: 150, y: 180 };
  const b3 = { x: 180, y: 220 };

  const x = clamp(zh, MAIN_ZH_SIZE_MIN, MAIN_ZH_SIZE_MAX);
  let y: number;
  if (x <= b2.x) {
    const t = (x - b1.x) / (b2.x - b1.x);
    y = b1.y + t * (b2.y - b1.y);
  } else {
    const t = (x - b2.x) / (b3.x - b2.x);
    y = b2.y + t * (b3.y - b2.y);
  }
  return clamp(Math.round(y), MAIN_EN_SIZE_MIN, MAIN_EN_SIZE_MAX);
}

function splitMixedTitleText(text: string) {
  const normalized = text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  const enLines: string[] = [];
  const zhLines: string[] = [];
  // 简单规则：包含任意中文字符（CJK）就判定该行归入中文
  const han = /[\u3400-\u9fff]/;
  for (const line of lines) {
    if (han.test(line)) zhLines.push(line);
    else enLines.push(line);
  }
  return {
    normalized,
    enText: enLines.join('\n'),
    zhText: zhLines.join('\n'),
  };
}

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

function normalizeSvgToBox(svg: string) {
  let s = svg.replace(/<\?xml[\s\S]*?\?>/g, '').trim();
  s = s.replace(/<!DOCTYPE[\s\S]*?>/g, '').trim();
  if (!s.includes('<svg')) return s;
  return s.replace(/<svg([^>]*)>/, (_match, p1) => {
    const cleaned = String(p1)
      .replace(/\s(width|height)=["'][^"']*["']/g, '')
      .replace(/\s(preserveAspectRatio)=["'][^"']*["']/g, '');
    return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
  });
}

const DEFAULT_LOGO_SVG = normalizeSvgToBox(xhsLogoRaw);

function svgToDataUri(svg: string) {
  const encoded = encodeURIComponent(svg)
    .replace(/%0A/g, '')
    .replace(/%0D/g, '')
    .replace(/%20/g, ' ')
    .replace(/%3D/g, '=')
    .replace(/%3A/g, ':')
    .replace(/%2F/g, '/')
    .replace(/%22/g, "'")
    .replace(/%2C/g, ',');
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

function inlineXhsLogoForExport(svg: string, x: number, y: number, w: number, h: number) {
  if (!svg || !svg.includes('<svg')) return '';
  const vbMatch = svg.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  const vbW = vbMatch ? Number(vbMatch[3]) : 99;
  const vbH = vbMatch ? Number(vbMatch[4]) : 47.14;
  const scaleX = w / (vbW || 99);
  const scaleY = h / (vbH || 47.14);

  // 取出 svg 内部内容，并把 class 样式转为行内 fill，避免 AI 丢失样式
  let inner = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();

  // 去掉 defs/style（AI 里容易和其它 svg 冲突/被忽略）
  inner = inner.replace(/<defs[\s\S]*?<\/defs>/gi, '').trim();

  // 将常见的 st0/st1 class 替换为行内样式（对应小红书 logo）
  inner = inner
    .replace(/\sclass=["']st1["']/g, ' fill="#ff2442"')
    .replace(/\sclass=["']st0["']/g, ' fill="#ffffff" fill-rule="evenodd"');

  // 包一层 group 做定位与缩放（用 viewBox 等比缩放到指定盒子）
  return `  <g transform="translate(${x}, ${y}) scale(${scaleX}, ${scaleY})">\n${inner}\n  </g>\n`;
}

const GuidesLayer = ({ visible }: { visible: boolean }) => {
  const margin = 50; // 四边距参考线：距边缘 50px
  const bottomLine = ARTBOARD_H - 170; // 距离下边缘 170px
  const rightOfA = 1270; // 距离左边缘 1270px
  const stroke = 2; // 参考线加粗：2px 更明显
  const color = 'rgba(145, 90, 253, 0.35)'; // 紫色参考线
  const regionFill = 'rgba(145, 90, 253, 0.18)'; // 主色半透明
  const regionStroke = 'rgba(145, 90, 253, 0.45)';
  const logoX = ARTBOARD_W - margin - LOGO_BOX.w;
  const logoY = margin;

  return (
    <div
      className={cx(
        'absolute inset-0 z-[100] pointer-events-none transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* 1) 四边距 50px：用直线表示（非框） */}
      {/* top */}
      <div
        className="absolute left-0 right-0"
        style={{ top: `${margin}px`, height: `${stroke}px`, backgroundColor: color }}
      />
      {/* bottom */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: `${ARTBOARD_H - margin - stroke}px`,
          height: `${stroke}px`,
          backgroundColor: color,
        }}
      />
      {/* left */}
      <div
        className="absolute top-0 bottom-0"
        style={{ left: `${margin}px`, width: `${stroke}px`, backgroundColor: color }}
      />
      {/* right */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: `${ARTBOARD_W - margin - stroke}px`,
          width: `${stroke}px`,
          backgroundColor: color,
        }}
      />

      {/* 2) 距底 170px 的水平线 */}
      <div
        className="absolute left-0 right-0"
        style={{ top: `${bottomLine}px`, height: `${stroke}px`, backgroundColor: color }}
      />

      {/* 3) 距左 1270px 的竖线 */}
      <div
        className="absolute top-0 bottom-0"
        style={{ left: `${rightOfA}px`, width: `${stroke}px`, backgroundColor: color }}
      />

      {/* 区域A：主标题限制区域 */}
      <div
        className="absolute"
        style={{
          left: `${AREA_A.x}px`,
          top: `${AREA_A.y}px`,
          width: `${AREA_A.w}px`,
          height: `${AREA_A.h}px`,
          backgroundColor: regionFill,
          outline: `2px solid ${regionStroke}`,
          outlineOffset: '-2px',
        }}
      />
      <div
        className="absolute text-[12px] font-black"
        style={{
          left: `${AREA_A.x + 10}px`,
          top: `${AREA_A.y + 10}px`,
          color: 'rgba(145, 90, 253, 0.85)',
        }}
      >
        区域A（{AREA_A.w}×{AREA_A.h}）
      </div>

      {/* LOGO 占位：99×47，贴齐上/右 50px 参考线 */}
      <div
        className="absolute"
        style={{
          left: `${logoX}px`,
          top: `${logoY}px`,
          width: `${LOGO_BOX.w}px`,
          height: `${LOGO_BOX.h}px`,
          outline: `2px dashed rgba(145, 90, 253, 0.55)`,
          outlineOffset: '-2px',
          backgroundColor: 'rgba(145, 90, 253, 0.06)',
        }}
      />
      <div
        className="absolute text-[11px] font-black"
        style={{
          left: `${logoX}px`,
          top: `${logoY + LOGO_BOX.h + 6}px`,
          color: 'rgba(145, 90, 253, 0.75)',
        }}
      >
        LOGO（{LOGO_BOX.w}×{LOGO_BOX.h}）
      </div>

      {/* 区域B：底部遮罩区域 1920×170 */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: `${ARTBOARD_H - AREA_B.h}px`,
          height: `${AREA_B.h}px`,
          backgroundColor: 'rgba(145, 90, 253, 0.10)',
          outline: `2px solid ${regionStroke}`,
          outlineOffset: '-2px',
        }}
      />
      <div
        className="absolute text-[12px] font-black"
        style={{
          left: `10px`,
          top: `${ARTBOARD_H - AREA_B.h + 10}px`,
          color: 'rgba(145, 90, 253, 0.85)',
        }}
      >
        区域B（1920×170）
      </div>
    </div>
  );
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function keepMaxLines(input: string, maxLines: number) {
  const lines = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  return lines.slice(0, maxLines).join('\n');
}

function escapeXml(input: string) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const AppShellHeader = ({
  activeTab,
  setActiveTab,
  onPreview,
}: {
  activeTab: AppTab;
  setActiveTab: (t: AppTab) => void;
  onPreview: () => void;
}) => {
  return (
    <div className="px-6 pt-6 pb-3 bg-white border-b border-slate-100">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[18px] md:text-[19px] font-extrabold text-slate-900 tracking-tight truncate">
            渠道模版工具
          </div>
          <div className="mt-1 text-[11px] font-bold text-slate-400 tracking-[0.18em] uppercase truncate">
            Advanced Layout Workbench
          </div>
        </div>

        <button
          type="button"
          onClick={onPreview}
          className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-900 text-white text-[12px] font-black"
        >
          <Eye size={16} />
          预览
        </button>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {(
          [
            { key: 'typography', label: '文字排版', icon: <Type size={16} /> },
            { key: 'graphic', label: '图形设计', icon: <Palette size={16} /> },
            { key: 'output', label: '输出文件', icon: <Download size={16} /> },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cx(
              'relative flex items-center justify-center gap-2 py-3 text-[12px] font-black rounded-2xl transition',
              activeTab === t.key
                ? 'text-slate-900'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {t.icon}
            {t.label}
            <span
              className={cx(
                'absolute left-5 right-5 -bottom-1 h-[3px] rounded-full transition',
                activeTab === t.key ? 'bg-[#9e76ff]' : 'bg-transparent',
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

const PanelCard = ({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) => {
  return (
    <section className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
      <header className="px-4 py-3.5 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="w-9 h-9 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700">
              {icon}
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-[#9e76ff]" />
          )}
          <h3 className="text-[13px] font-black tracking-tight text-slate-900">
            {title}
          </h3>
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
};

const FieldLabel = ({
  label,
  hint,
  value,
}: {
  label: string;
  hint?: string;
  value?: string;
}) => {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[11px] font-black text-slate-700">{label}</div>
        {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
      </div>
      {value && (
        <div className="text-[11px] font-black text-slate-700 tabular-nums">
          {value}
        </div>
      )}
    </div>
  );
};

const Segmented = <T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) => {
  return (
    <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cx(
            'flex-1 py-2 text-[11px] font-black rounded-lg transition',
            value === opt.value
              ? 'bg-white text-[#9e76ff] shadow-sm'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        'w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left transition',
        checked
          ? 'bg-[#9e76ff]/10 border-[#9e76ff]/25'
          : 'bg-white border-slate-200 hover:bg-slate-50',
      )}
    >
      <span className="text-[11px] font-black text-slate-700">{label}</span>
      <span
        className={cx(
          'w-10 h-6 rounded-full relative transition',
          checked ? 'bg-[#9e76ff]' : 'bg-slate-300',
        )}
      >
        <span
          className={cx(
            'absolute top-1 w-4 h-4 bg-white rounded-full transition-all',
            checked ? 'left-5' : 'left-1',
          )}
        />
      </span>
    </button>
  );
};

const IconToggle = ({
  on,
  onClick,
  iconOn,
  iconOff,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
  label: string;
  disabled?: boolean;
}) => {
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      className={cx(
        'w-9 h-9 rounded-2xl border flex items-center justify-center transition',
        disabled
          ? 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed'
          : on
          ? 'border-[#9e76ff]/40 bg-[#9e76ff]/10 text-[#9e76ff]'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
      )}
      aria-label={label}
      title={label}
    >
      {on ? iconOn : iconOff}
    </button>
  );
};

const Slider = ({
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
  unit,
  disabled,
  compact,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  disabled?: boolean;
  compact?: boolean;
}) => {
  const display = unit ? `${value}${unit}` : `${value}`;
  const btnCls = compact ? 'w-8 h-8 rounded-xl' : 'w-10 h-10 rounded-2xl';
  const iconSize = compact ? 14 : 16;
  return (
    <div className={cx('space-y-2', disabled && 'opacity-60')}>
      <FieldLabel label={label} hint={hint} value={display} />
      <div
        className={cx(
          'flex items-center gap-2',
          compact && 'gap-1.5',
          disabled && 'cursor-not-allowed',
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            onChange(clamp(value - step, min, max));
          }}
          disabled={disabled}
          className={cx(
            `${btnCls} border border-slate-200 bg-white flex items-center justify-center shrink-0`,
            disabled ? 'bg-slate-50' : 'hover:bg-slate-50',
          )}
          aria-label="decrease"
        >
          <Minus size={iconSize} />
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            if (disabled) return;
            onChange(Number(e.target.value));
          }}
          disabled={disabled}
          className={cx(
            'flex-1 min-w-0 accent-[#9e76ff]',
            disabled && 'accent-slate-300',
          )}
        />
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            onChange(clamp(value + step, min, max));
          }}
          disabled={disabled}
          className={cx(
            `${btnCls} border border-slate-200 bg-white flex items-center justify-center shrink-0`,
            disabled ? 'bg-slate-50' : 'hover:bg-slate-50',
          )}
          aria-label="increase"
        >
          <Plus size={iconSize} />
        </button>
      </div>
    </div>
  );
};

const ColorDots = ({
  label,
  colors,
  selected,
  onToggle,
}: {
  label: string;
  colors: string[];
  selected: string[];
  onToggle: (c: string) => void;
}) => {
  return (
    <div className="space-y-2">
      <FieldLabel label={label} hint="可多选" />
      <div className="flex items-center gap-2 flex-wrap">
        {colors.map((c) => {
          const isOn = selected.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => onToggle(c)}
              className={cx(
                'w-10 h-10 rounded-full border flex items-center justify-center transition',
                isOn ? 'border-[#9e76ff] ring-2 ring-[#9e76ff]/20' : 'border-slate-200',
              )}
              aria-label={`color ${c}`}
            >
              <span
                className="w-7 h-7 rounded-full"
                style={{ backgroundColor: c }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ColorPickDots = ({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: string[];
  value: string;
  onPick: (c: string) => void;
}) => {
  return (
    <div className="space-y-2">
      <FieldLabel label={label} hint="单选" />
      <div className="flex items-center gap-2 flex-wrap">
        {colors.map((c) => {
          const isOn = value === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              className={cx(
                'w-10 h-10 rounded-full border flex items-center justify-center transition',
                isOn
                  ? 'border-[#9e76ff] ring-2 ring-[#9e76ff]/20'
                  : 'border-slate-200',
              )}
              aria-label={`pick color ${c}`}
            >
              <span className="w-7 h-7 rounded-full" style={{ backgroundColor: c }} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

type LineColorOption =
  | { id: string; kind: 'solid'; value: string }
  | { id: string; kind: 'special'; value: 'sandwich' | 'sandwich2' };

const LineColorDots = ({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: LineColorOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) => {
  const previewStyle = (opt: LineColorOption): React.CSSProperties => {
    if (opt.kind === 'solid') return { backgroundColor: opt.value };
    if (opt.value === 'sandwich') {
      return {
        backgroundImage:
          'linear-gradient(to bottom, #9e76ff 0%, #ffdf7a 25%, #dfd9ff 50%, #ffdf7a 75%, #9e76ff 100%)',
      };
    }
    return {
      backgroundImage:
        'linear-gradient(to bottom, #9e76ff 0%, #985946 25%, #dfd9ff 50%, #985946 75%, #9e76ff 100%)',
    };
  };

  return (
    <div className="space-y-2">
      <FieldLabel label={label} hint="最多选 3 种" />
      <div className="flex items-center gap-2 flex-wrap">
        {options.map((opt) => {
          const isOn = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggle(opt.id)}
              className={cx(
                'w-10 h-10 rounded-full border flex items-center justify-center transition',
                isOn
                  ? 'border-[#9e76ff] ring-2 ring-[#9e76ff]/20'
                  : 'border-slate-200',
              )}
              aria-label={`line color ${opt.id}`}
            >
              <span className="w-7 h-7 rounded-full" style={previewStyle(opt)} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const DotLayer = ({ state }: { state: LayoutState }) => {
  const availableColors = DOT_COLORS[state.bgColor] || DOT_COLORS['#ffffff'];
  const filteredAvailable = availableColors.filter((c) => c !== state.bgColor);
  const selectedColors =
    state.dotColors.length > 0
      ? state.dotColors.filter((c) => c !== state.bgColor)
      : [filteredAvailable[0]];

  // 需求：点方向里 preset1/preset3 的“点生成”整体再向下偏移
  const dotPresetYOffsetPx =
    state.dotPreset === 'preset1'
      ? 100
      : state.dotPreset === 'preset3'
        ? 50
        : 0;

  const dots = useMemo(() => {
    let seed = state.dotSeed;
    const random = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    // “单向流动”点阵：沿方向向量分布，两端更密，中间更稀
    // dotRotation 直接控制流动方向（0°=水平横向），流带固定居中
    const angle = (state.dotRotation * Math.PI) / 180;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const nX = Math.cos(angle + Math.PI / 2);
    const nY = Math.sin(angle + Math.PI / 2);

    const centerX = 50;
    const centerY = 50;
    const halfLen = state.dotSideSpread; // 左右分散：流带半长度（百分比）

    // U 型分布：更靠近两端（类似截图那种两端密集感）
    // 通过 exponent 控制“中间稀疏程度”：preset2 略微加大 exponent，使中间点更少
    const uExponent = state.dotPreset === 'preset2' ? 0.45 : 0.35;
    const sampleUShapeT = () => {
      const r = random();
      if (r < 0.5) {
        return Math.pow(random(), uExponent) * 0.5; // 0..0.5 更靠近 0
      }
      return 1 - Math.pow(random(), uExponent) * 0.5; // 0.5..1 更靠近 1
    };

    // 颜色强制分配：确保 4 色都出现；棕/黄至少各 2 个
    // 注意：如果用户未在色盘里选满 4 种颜色，则只能保证“已选择的颜色集合”满足该规则。
    const YELLOW_COLOR = '#ffdf7a';
    const BROWN_COLOR = '#985946';
    const minsByColor: Record<string, number> = {};
    selectedColors.forEach((c) => (minsByColor[c] = 1));
    if (selectedColors.includes(YELLOW_COLOR)) minsByColor[YELLOW_COLOR] = 2;
    if (selectedColors.includes(BROWN_COLOR)) minsByColor[BROWN_COLOR] = 2;
    const forcedColorsAll: string[] = [];
    selectedColors.forEach((c) => {
      const n = minsByColor[c] ?? 0;
      for (let k = 0; k < n; k++) forcedColorsAll.push(c);
    });
    const forcedColors = forcedColorsAll.slice(0, state.dotCount);

    return Array.from({ length: state.dotCount }).map((_unused, i) => {
      const size = [95, 70, 45][Math.floor(random() * 3)];
      const margin = (size / 1920) * 100;

      // 沿方向的进度 t（0..1），两端密集
      const t = sampleUShapeT();
      // 沿法线的扰动：用 spread 控制“流带”厚度
      const thickness = state.dotSpread * 0.55;
      const jitterN = (random() - 0.5) * thickness;
      const jitterAlong = (random() - 0.5) * (state.dotSpread * 0.12);

      let x =
        centerX +
        dirX * ((t - 0.5) * 2 * halfLen + jitterAlong) +
        nX * jitterN;
      let y =
        centerY +
        dirY * ((t - 0.5) * 2 * halfLen + jitterAlong) +
        nY * jitterN;

      // 轻微“漂移”，让画面更自然
      x += (random() - 0.5) * 1.2;
      y += (random() - 0.5) * 1.2;

      x = Math.max(margin, Math.min(100 - margin, x));
      y = Math.max(margin, Math.min(100 - margin, y));

      const purples = filteredAvailable.slice(0, 2);
      const selectedPurples = selectedColors.filter((c) => purples.includes(c));
      const otherSelected = selectedColors.filter((c) => !purples.includes(c));

      let color;
      if (
        selectedPurples.length > 0 &&
        (random() < 0.7 || otherSelected.length === 0)
      ) {
        color =
          selectedPurples[Math.floor(random() * selectedPurples.length)];
      } else {
        color = selectedColors[Math.floor(random() * selectedColors.length)];
      }

      // 对前若干个点强制指定颜色，满足“4色都出现 + 棕黄至少2个”
      if (i < forcedColors.length) {
        color = forcedColors[i];
      }

      const shape =
        state.dotShape === 'random'
          ? (['circle', 'triangle', 'square'][
              Math.floor(random() * 3)
            ] as 'circle' | 'triangle' | 'square')
          : (state.dotShape as 'circle' | 'triangle' | 'square');

      const rotation = random() * 360;

      return { x, y, size, color, shape, rotation };
    });
  }, [
    state.bgColor,
    state.dotShape,
    state.dotCount,
    state.dotSpread,
    state.dotSeed,
    state.dotRotation,
    state.dotColors,
    filteredAvailable,
    selectedColors,
  ]);

  return (
    <div
      className="absolute inset-0 z-40 pointer-events-none transition-transform duration-500"
      style={{
        transform: `translate(${state.dotX}px, ${state.dotY + dotPresetYOffsetPx}px)`,
      }}
    >
      {dots.map((dot, i) => (
        <div
          key={i}
          className="absolute transition-all duration-700 ease-out"
          style={{
            left: `${dot.x}%`,
            top: `${dot.y}%`,
            width: `${dot.size}px`,
            height: `${dot.size}px`,
            backgroundColor: dot.color,
            transform: `translate(-50%, -50%) rotate(${dot.rotation}deg)`,
            borderRadius: dot.shape === 'circle' ? '50%' : '0%',
            clipPath:
              dot.shape === 'triangle'
                ? 'polygon(50% 15%, 5% 93%, 95% 93%)'
                : 'none',
          }}
        />
      ))}
    </div>
  );
};

const LineLayer = ({ state }: { state: LayoutState }) => {
  const availableColors = DOT_COLORS[state.bgColor] || DOT_COLORS['#ffffff'];
  const filteredAvailable = availableColors.filter((c) => c !== state.bgColor);
  const selectedColors =
    state.lineColors.length > 0
      ? state.lineColors.filter((c) => c !== state.bgColor)
      : [filteredAvailable[0]];

  const finalColors = selectedColors.length > 0 ? selectedColors : [filteredAvailable[0]];

  const lines = useMemo(() => {
    let seed = state.lineSeed;
    const random = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const count = state.lineCount;
    const thickness = state.lineThickness;
    const totalHeight = count * thickness;
    const startY = (900 - totalHeight) / 2;

    return Array.from({ length: count }).map((_, i) => {
      const minWidth = 100 + (1 - state.lineLengthContrast) * 800;
      const maxWidth = 1920;
      const width = minWidth + random() * (maxWidth - minWidth);
      const x = random() * (1920 - width) + state.lineX;
      const y = startY + i * thickness + state.lineY;
      const color = finalColors[i % finalColors.length];
      return { x, y, width, color };
    });
  }, [
    state.lineCount,
    state.lineThickness,
    state.lineColors,
    state.lineLengthContrast,
    state.lineSeed,
    state.lineX,
    state.lineY,
    finalColors,
  ]);

  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
      {lines.map((line, i) => (
        <div
          key={i}
          className="absolute transition-all duration-500"
          style={{
            left: `${line.x}px`,
            top: `${line.y}px`,
            width: `${line.width}px`,
            height: `${state.lineThickness}px`,
            background:
              line.color === 'sandwich'
                ? 'linear-gradient(to bottom, #9e76ff 0%, #9e76ff 20%, #ffdf7a 20%, #ffdf7a 40%, #dfd9ff 40%, #dfd9ff 60%, #ffdf7a 60%, #ffdf7a 80%, #9e76ff 80%, #9e76ff 100%)'
                : line.color === 'sandwich2'
                ? 'linear-gradient(to bottom, #9e76ff 0%, #9e76ff 20%, #985946 20%, #985946 40%, #dfd9ff 40%, #dfd9ff 60%, #985946 60%, #985946 80%, #9e76ff 80%, #9e76ff 100%)'
                : line.color,
          }}
        />
      ))}
    </div>
  );
};

const computePlaneShapes = (
  planeShape: LayoutState['planeShape'],
  planeSeed: number,
) => {
  if (planeShape !== 'random') return { s1: planeShape, s2: planeShape };
  let seed = planeSeed;
  const random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  const possible = ['square', 'circle', 'triangle'] as const;
  const s1 = possible[Math.floor(random() * 3)];
  let s2 = possible[Math.floor(random() * 3)];
  if (s1 === s2) s2 = possible[(possible.indexOf(s1) + 1) % 3];
  return { s1, s2 };
};

const PlaneLayer = ({ state }: { state: LayoutState }) => {
  const availableColors = DOT_COLORS[state.bgColor] || DOT_COLORS['#ffffff'];
  // 提示：图形颜色必须严格按配置渲染，不做“等于底色则替换”的处理
  // 否则会导致预设颜色（例如 #dfd9ff）在底色为同色时显示错误。

  const renderPlane = (
    config: PlaneConfig,
    shapeOverride?: 'square' | 'circle' | 'triangle',
  ) => {
    const type = shapeOverride || config.type;
    const color = config.color;

    const style: React.CSSProperties = {
      position: 'absolute',
      left: `${config.x}%`,
      top: `${config.y}%`,
      backgroundColor: color,
      transform: `translate(-50%, -50%) rotate(${config.angle}deg)`,
      transition: 'all 0.5s ease-out',
    };

    if (type === 'circle') {
      style.width = `${config.width}px`;
      style.height = `${config.height}px`;
      style.borderRadius = '50%';
    } else if (type === 'square') {
      style.width = `${config.width}px`;
      style.height = `${config.height}px`;
    } else if (type === 'triangle') {
      style.width = `${config.radius * 2}px`;
      style.height = `${config.radius * 2}px`;
      const points = Array.from({ length: config.sides })
        .map((_, i) => {
          const angle = (i / config.sides) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + 50 * Math.cos(angle);
          const y = 50 + 50 * Math.sin(angle);
          return `${x}% ${y}%`;
        })
        .join(', ');
      style.clipPath = `polygon(${points})`;
    }

    return <div style={style} />;
  };

  const shapes = useMemo(() => {
    return computePlaneShapes(state.planeShape, state.planeSeed);
  }, [state.planeShape, state.planeSeed]);

  return (
    <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
      {state.planeOrder === '1-over-2' ? (
        <>
          {renderPlane(state.plane2, shapes.s2)}
          {renderPlane(state.plane1, shapes.s1)}
        </>
      ) : (
        <>
          {renderPlane(state.plane1, shapes.s1)}
          {renderPlane(state.plane2, shapes.s2)}
        </>
      )}
    </div>
  );
};

const SvgLayer = ({
  state,
  updateSvg,
}: {
  state: LayoutState;
  updateSvg: (id: string, updates: Partial<UploadedSvg>) => void;
}) => {
  return (
    <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
      {state.uploadedSvgs.map((svg) => (
        <div
          key={svg.id}
          className="absolute pointer-events-auto cursor-move select-none"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startY = e.clientY;
            const initialX = svg.x;
            const initialY = svg.y;
            const onMouseMove = (moveEvent: MouseEvent) => {
              const deltaX = ((moveEvent.clientX - startX) / 1920) * 100;
              const deltaY = ((moveEvent.clientY - startY) / 900) * 100;
              updateSvg(svg.id, {
                x: initialX + deltaX,
                y: initialY + deltaY,
              });
            };
            const onMouseUp = () => {
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
          }}
          // SVG 内容本身由你上传的文件决定
          dangerouslySetInnerHTML={{ __html: svg.content }}
          style={{
            left: `${svg.x}%`,
            top: `${svg.y}%`,
            transform: `translate(-50%, -50%) scale(${svg.flipH ? -svg.scale : svg.scale}, ${svg.flipV ? -svg.scale : svg.scale}) rotate(${svg.rotation}deg)`,
            transition: 'transform 0.2s ease-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      ))}
    </div>
  );
};

export default function App() {
  const [state, setState] = useState<LayoutState>(() => {
    const saved = localStorage.getItem('simplelayout_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // 固定规范：标题间距、英文行距始终不变
        const merged: LayoutState = {
          ...initialLayoutState,
          ...parsed,
          activeTab: 'typography',
          titleGap: TITLE_GAP_PX,
          mainEnLineHeight: MAIN_EN_LINE_HEIGHT,
          mainZhLineHeight: MAIN_ZH_LINE_HEIGHT,
          logoSvg: normalizeSvgToBox(parsed.logoSvg ?? DEFAULT_LOGO_SVG),
        };

        // 颜色白名单过滤：防止旧 localStorage 里保存了非法颜色
        merged.dotColors = sanitizeAllowedColorArray(
          merged.dotColors,
          initialLayoutState.dotColors[0],
        );
        merged.lineColors = sanitizeAllowedColorArray(
          merged.lineColors,
          initialLayoutState.lineColors[0],
        );
        merged.plane1 = {
          ...merged.plane1,
          color: sanitizeAllowedColor(merged.plane1.color, initialLayoutState.plane1.color),
        };
        merged.plane2 = {
          ...merged.plane2,
          color: sanitizeAllowedColor(merged.plane2.color, initialLayoutState.plane2.color),
        };

        // 强制覆盖 3 个预设的颜色组合（四种颜色中只用你指定的两色组合）
        // 预设1：plane1 #9e76ff + plane2 #ffdf7a
        // 预设2：plane1 #985946 + plane2 #9e76ff
        // 预设3：plane1 #9e76ff + plane2 #985946
        const enforcePairs = (cfg: any, idx: number) => {
          if (!cfg) return cfg;
          const nextPlane1 =
            idx === 0
              ? '#9e76ff'
              : idx === 1
                ? '#985946'
                : '#9e76ff';
          const nextPlane2 =
            idx === 0
              ? '#ffdf7a'
              : idx === 1
                ? '#9e76ff'
                : '#ffdf7a';
          return {
            ...cfg,
            plane1: { ...cfg.plane1, color: nextPlane1 },
            plane2: { ...cfg.plane2, color: nextPlane2 },
          };
        };

        merged.squarePlanePresets = (merged.squarePlanePresets || []).map((cfg, i) =>
          enforcePairs(cfg, i),
        );
        merged.circlePlanePresets = (merged.circlePlanePresets || []).map((cfg, i) =>
          enforcePairs(cfg, i),
        );
        merged.trianglePlanePresets = (merged.trianglePlanePresets || []).map((cfg, i) =>
          enforcePairs(cfg, i),
        );
        merged.randomPlanePresets = (merged.randomPlanePresets || []).map((cfg, i) =>
          enforcePairs(cfg, i),
        );

        // 主标题：统一为“一个文本内容”，但内部依然拆分为英/中行渲染
        const derivedMixed =
          (merged.mainMixedText && merged.mainMixedText.trim().length > 0
            ? merged.mainMixedText
            : [merged.mainEnText, merged.mainZhText].filter(Boolean).join('\n')) ?? '';
        const { normalized, enText, zhText } =
          splitMixedTitleText(derivedMixed);
        merged.mainMixedText = normalized;
        merged.mainEnText = enText;
        merged.mainZhText = zhText;

        return merged;
      } catch {
        return { ...initialLayoutState, logoSvg: DEFAULT_LOGO_SVG };
      }
    }
    return { ...initialLayoutState, logoSvg: DEFAULT_LOGO_SVG };
  });
  const [scale, setScale] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(440); // 最大宽度=当前默认
  const scalerRef = useRef<HTMLDivElement>(null);
  const desktopViewportRef = useRef<HTMLDivElement>(null);
  const mobileViewportRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('simplelayout_settings', JSON.stringify(state));
  }, [state]);

  // 点阵趋势走向固定为“单向”
  useEffect(() => {
    if (state.dotTrend === 'single') return;
    setState((prev) => ({ ...prev, dotTrend: 'single' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点阵预设只保留 1/2/3：如果当前落在 4/5，自动切回 1，避免出现“没有选中按钮”
  useEffect(() => {
    if (state.graphicType !== 'dot') return;
    if (state.dotPreset === 'preset4' || state.dotPreset === 'preset5') {
      setState((prev) => ({ ...prev, dotPreset: 'preset1' }));
    }
  }, [state.graphicType, state.dotPreset]);

  // 固定规范：标题间距始终 14px，英文行距始终 0.9
  useEffect(() => {
    setState((prev) => {
      const next: Partial<LayoutState> = {};
      if (prev.titleGap !== TITLE_GAP_PX) next.titleGap = TITLE_GAP_PX;
      if (prev.mainEnLineHeight !== MAIN_EN_LINE_HEIGHT)
        next.mainEnLineHeight = MAIN_EN_LINE_HEIGHT;
      if (prev.mainZhLineHeight !== MAIN_ZH_LINE_HEIGHT)
        next.mainZhLineHeight = MAIN_ZH_LINE_HEIGHT;
      if (prev.sub1Size !== SUB1_SIZE_PX) next.sub1Size = SUB1_SIZE_PX;
      if (prev.sub2Size !== SUB2_SIZE_PX) next.sub2Size = SUB2_SIZE_PX;
      return Object.keys(next).length ? ({ ...prev, ...next } as LayoutState) : prev;
    });
  }, []);

  // 中英文同时出现时：字号联动缩放（中文跟随英文比例）
  useEffect(() => {
    if (!state.isSizeLinked) return;
    const desiredZh = mapEnToZh(state.mainEnSize);
    if (state.mainZhSize === desiredZh) return;
    setState((prev) => ({ ...prev, mainZhSize: desiredZh }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isSizeLinked, state.mainEnSize, state.mainZhSize]);

  // 保证主标题中英字号始终保持当前比例缩放
  useEffect(() => {
    setState((prev) => (prev.isSizeLinked ? prev : { ...prev, isSizeLinked: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主标题：固定粗黑（700），并始终显示中英文两层
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      showMainEn: true,
      showMainZh: true,
      mainEnWeight: 700,
      mainZhWeight: 700,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMainEnSizeSynced = (v: number) => {
    const clamped = clamp(v, MAIN_EN_SIZE_MIN, MAIN_EN_SIZE_MAX);
    setState((prev) => {
      if (prev.isSizeLinked) {
        return {
          ...prev,
          mainEnSize: clamped,
          mainZhSize: mapEnToZh(clamped),
        };
      }
      return { ...prev, mainEnSize: clamped };
    });
  };

  const setMainZhSizeSynced = (v: number) => {
    const zh = clamp(v, MAIN_ZH_SIZE_MIN, MAIN_ZH_SIZE_MAX);
    setState((prev) => {
      if (prev.isSizeLinked) {
        const en = mapZhToEn(zh);
        return {
          ...prev,
          mainEnSize: en,
          mainZhSize: mapEnToZh(en),
        };
      }
      return { ...prev, mainZhSize: zh };
    });
  };

  const setMainMixedText = (v: string) => {
    const { normalized, enText, zhText } = splitMixedTitleText(v);
    setState((prev) => ({
      ...prev,
      mainMixedText: normalized,
      mainEnText: enText,
      mainZhText: zhText,
    }));
  };

  // 方案B：画布逻辑尺寸固定 1920×900，但在网页内自适应缩放，始终完整露出（最多 100%）
  useLayoutEffect(() => {
    const getActiveViewport = () => {
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      if (isDesktop) return desktopViewportRef.current;
      return mobileView === 'preview' ? mobileViewportRef.current : null;
    };

    const recompute = () => {
      const el = getActiveViewport();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const next = Math.min(w / ARTBOARD_W, h / ARTBOARD_H, 1);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    recompute();
    const ro = new ResizeObserver(() => recompute());
    if (desktopViewportRef.current) ro.observe(desktopViewportRef.current);
    if (mobileViewportRef.current) ro.observe(mobileViewportRef.current);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [mobileView]);

  const updateState = <K extends keyof LayoutState>(
    key: K,
    value: LayoutState[K],
  ) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const activeTab = state.activeTab;
  const setActiveTab = (tab: AppTab) => updateState('activeTab', tab);

  const updateSvg = (id: string, updates: Partial<UploadedSvg>) => {
    setState((prev) => ({
      ...prev,
      uploadedSvgs: prev.uploadedSvgs.map((svg) =>
        svg.id === id ? { ...svg, ...updates } : svg,
      ),
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && state.uploadedSvgs.length < 4) {
      const reader = new FileReader();
      reader.onload = (event) => {
        let content = event.target?.result as string;
        if (content.includes('<svg')) {
          content = content.replace(/<svg([^>]*)>/, (match, p1) => {
            let newP1 = p1.replace(
              /\s(width|height)=["'][^"']*["']/g,
              '',
            );
            return `<svg${newP1} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
          });
        }
        const newSvg: UploadedSvg = {
          id: Math.random().toString(36).substr(2, 9),
          content,
          x: 50,
          y: 50,
          scale: 1,
          rotation: 0,
          flipH: false,
          flipV: false,
        };
        updateState('uploadedSvgs', [...state.uploadedSvgs, newSvg]);
      };
      reader.readAsText(file);
    }
  };

  const exportImage = async (format: 'png' | 'jpeg') => {
    if (!artboardRef.current) return;
    setIsExporting(true);
    try {
      const originalTransform = artboardRef.current.style.transform;
      artboardRef.current.style.transform = 'none';
      const options = {
        width: 1920,
        height: 900,
        style: { transform: 'none', left: '0', top: '0' },
      };
      const dataUrl =
        format === 'png'
          ? await htmlToImage.toPng(artboardRef.current, options)
          : await htmlToImage.toJpeg(artboardRef.current, {
              ...options,
              quality: 0.95,
            });
      artboardRef.current.style.transform = originalTransform;
      download(dataUrl, `layout-design.${format}`);
      setToast(`已导出 ${format.toUpperCase()}（1920×900）`);
    } catch (err) {
      console.error('Export failed', err);
      setToast('导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  };

  const getFontFamily = (weight: number, isSvg = false) => {
    const svgHeavy =
      "'方正兰亭粗黑简体','方正兰亭中粗黑简体','FZLanTingKanHei-H-GBK','FZLanTingKanHei-H','FZLTKHK--H','Inter','Noto Sans SC',ui-sans-serif,system-ui,sans-serif";
    const svgMedium =
      "'方正兰亭中粗黑简体','方正兰亭粗黑简体','FZLanTingKanHei-B-GBK','FZLanTingKanHei-B','FZLTKHK--B','Inter','Noto Sans SC',ui-sans-serif,system-ui,sans-serif";
    const svgRegular =
      "'Inter','Noto Sans SC','PingFang SC','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif";
    if (weight >= 700) {
      return isSvg
        ? svgHeavy
        : "'方正兰亭粗黑简体', '方正兰亭中粗黑简体', 'Inter', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif";
    }
    if (weight >= 600) {
      return isSvg
        ? svgMedium
        : "'方正兰亭中粗黑简体', '方正兰亭粗黑简体', 'Inter', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif";
    }
    return isSvg
      ? svgRegular
      : "'Inter', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif";
  };

  const exportSvg = () => {
    if (!artboardRef.current) return;
    const width = 1920;
    const height = 900;
    let svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <style>
      text {
        font-family: '方正兰亭粗黑简体','方正兰亭中粗黑简体','FZLanTingKanHei-H-GBK','FZLanTingKanHei-H','FZLTKHK--H',
                     'FZLanTingKanHei-B-GBK','FZLanTingKanHei-B','FZLTKHK--B',
                     'Inter','Noto Sans SC','PingFang SC','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif;
      }
    </style>
    <linearGradient id="sandwich" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9e76ff" />
      <stop offset="20%" stop-color="#9e76ff" />
      <stop offset="20%" stop-color="#ffdf7a" />
      <stop offset="40%" stop-color="#ffdf7a" />
      <stop offset="40%" stop-color="#dfd9ff" />
      <stop offset="60%" stop-color="#dfd9ff" />
      <stop offset="60%" stop-color="#ffdf7a" />
      <stop offset="80%" stop-color="#ffdf7a" />
      <stop offset="80%" stop-color="#9e76ff" />
      <stop offset="100%" stop-color="#9e76ff" />
    </linearGradient>
    <linearGradient id="sandwich2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9e76ff" />
      <stop offset="20%" stop-color="#9e76ff" />
      <stop offset="20%" stop-color="#985946" />
      <stop offset="40%" stop-color="#985946" />
      <stop offset="40%" stop-color="#dfd9ff" />
      <stop offset="60%" stop-color="#dfd9ff" />
      <stop offset="60%" stop-color="#985946" />
      <stop offset="80%" stop-color="#985946" />
      <stop offset="80%" stop-color="#9e76ff" />
      <stop offset="100%" stop-color="#9e76ff" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${state.bgColor}" />
`;

    if (state.graphicType === 'dot') {
      const availableColors = DOT_COLORS[state.bgColor] || DOT_COLORS['#ffffff'];
      const filteredAvailable = availableColors.filter(
        (c) => c !== state.bgColor,
      );
      const selectedColors =
        state.dotColors.length > 0
          ? state.dotColors.filter((c) => c !== state.bgColor)
          : [filteredAvailable[0]];
      let seed = state.dotSeed;
      const random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };
      const angle = (state.dotRotation * Math.PI) / 180;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const nX = Math.cos(angle + Math.PI / 2);
      const nY = Math.sin(angle + Math.PI / 2);
      const centerX = 50;
      const centerY = 50;
      const halfLen = state.dotSideSpread;
      // 需求：点方向里 preset1/preset3 的“点生成”整体再向下偏移
      const dotPresetYOffsetPx =
        state.dotPreset === 'preset1'
          ? 100
          : state.dotPreset === 'preset3'
            ? 50
            : 0;
      // SVG 导出与预览保持一致：preset2 略微增强中间稀疏度
      const uExponent = state.dotPreset === 'preset2' ? 0.45 : 0.35;
      // 颜色强制分配：确保 4 色都出现；棕/黄至少各 2 个
      // 注意：如果用户未在色盘里选满 4 种颜色，则只能保证“已选择的颜色集合”满足该规则。
      const YELLOW_COLOR = '#ffdf7a';
      const BROWN_COLOR = '#985946';
      const minsByColor: Record<string, number> = {};
      selectedColors.forEach((c) => (minsByColor[c] = 1));
      if (selectedColors.includes(YELLOW_COLOR)) minsByColor[YELLOW_COLOR] = 2;
      if (selectedColors.includes(BROWN_COLOR)) minsByColor[BROWN_COLOR] = 2;
      const forcedColorsAll: string[] = [];
      selectedColors.forEach((c) => {
        const n = minsByColor[c] ?? 0;
        for (let k = 0; k < n; k++) forcedColorsAll.push(c);
      });
      const forcedColors = forcedColorsAll.slice(0, state.dotCount);

      const sampleUShapeT = () => {
        const r = random();
        if (r < 0.5) return Math.pow(random(), uExponent) * 0.5;
        return 1 - Math.pow(random(), uExponent) * 0.5;
      };
      svgContent += `  <g transform="translate(${state.dotX}, ${state.dotY + dotPresetYOffsetPx})">
`;
      for (let i = 0; i < state.dotCount; i++) {
        const size = [95, 70, 45][Math.floor(random() * 3)];
        const margin = (size / 1920) * 100;
        const t = sampleUShapeT();
        const thickness = state.dotSpread * 0.55;
        const jitterN = (random() - 0.5) * thickness;
        const jitterAlong = (random() - 0.5) * (state.dotSpread * 0.12);
        let x =
          centerX +
          dirX * ((t - 0.5) * 2 * halfLen + jitterAlong) +
          nX * jitterN;
        let y =
          centerY +
          dirY * ((t - 0.5) * 2 * halfLen + jitterAlong) +
          nY * jitterN;
        x += (random() - 0.5) * 1.2;
        y += (random() - 0.5) * 1.2;
        x = Math.max(margin, Math.min(100 - margin, x));
        y = Math.max(margin, Math.min(100 - margin, y));
        let color = selectedColors[Math.floor(random() * selectedColors.length)];
        if (i < forcedColors.length) color = forcedColors[i];
        const shape =
          state.dotShape === 'random'
            ? ['circle', 'triangle', 'square'][Math.floor(random() * 3)]
            : state.dotShape;
        const rotation = random() * 360;
        const px = (x / 100) * width;
        const py = (y / 100) * height;
        if (shape === 'circle')
          svgContent += `    <circle cx="${px}" cy="${py}" r="${
            size / 2
          }" fill="${color}" transform="rotate(${rotation}, ${px}, ${py})" />
`;
        else if (shape === 'square')
          svgContent += `    <rect x="${px - size / 2}" y="${
            py - size / 2
          }" width="${size}" height="${size}" fill="${color}" transform="rotate(${rotation}, ${px}, ${py})" />
`;
        else if (shape === 'triangle')
          svgContent += `    <polygon points="${px},${
            py - size / 2 + size * 0.15
          } ${px - size / 2 + size * 0.05},${
            py - size / 2 + size * 0.93
          } ${px - size / 2 + size * 0.95},${
            py - size / 2 + size * 0.93
          }" fill="${color}" transform="rotate(${rotation}, ${px}, ${py})" />
`;
      }
      svgContent += `  </g>
`;
    } else if (state.graphicType === 'line') {
      let seed = state.lineSeed;
      const random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };
      const count = state.lineCount;
      const thickness = state.lineThickness;
      const startY = (height - count * thickness) / 2;
      for (let i = 0; i < count; i++) {
        const lineWidth =
          100 +
          (1 - state.lineLengthContrast) * 800 +
          random() *
            (1920 - (100 + (1 - state.lineLengthContrast) * 800));
        const x = random() * (1920 - lineWidth) + state.lineX;
        const y = startY + i * thickness + state.lineY;
        let fill = state.lineColors[i % state.lineColors.length];
        if (fill === 'sandwich') fill = 'url(#sandwich)';
        if (fill === 'sandwich2') fill = 'url(#sandwich2)';
        svgContent += `  <rect x="${x}" y="${y}" width="${lineWidth}" height="${thickness}" fill="${fill}" />
`;
      }
    } else if (state.graphicType === 'plane') {
      const renderPlaneSvg = (p: any, type: string) => {
        const x = (p.x / 100) * width;
        const y = (p.y / 100) * height;
        if (type === 'circle')
          return `<ellipse cx="${x}" cy="${y}" rx="${p.width / 2}" ry="${
            p.height / 2
          }" fill="${p.color}" transform="rotate(${p.angle}, ${x}, ${y})" />`;
        if (type === 'square')
          return `<rect x="${x - p.width / 2}" y="${
            y - p.height / 2
          }" width="${p.width}" height="${p.height}" fill="${
            p.color
          }" transform="rotate(${p.angle}, ${x}, ${y})" />`;
        if (type === 'triangle') {
          const points = Array.from({ length: p.sides })
            .map((_, i) => {
              const a = (i / p.sides) * Math.PI * 2 - Math.PI / 2;
              return `${x + Math.cos(a) * p.radius},${
                y + Math.sin(a) * p.radius
              }`;
            })
            .join(' ');
          return `<polygon points="${points}" fill="${p.color}" transform="rotate(${p.angle}, ${x}, ${y})" />`;
        }
        return '';
      };
      const { s1: p1Type, s2: p2Type } = computePlaneShapes(
        state.planeShape,
        state.planeSeed,
      );
      if (state.planeOrder === '1-over-2') {
        svgContent += `  ${renderPlaneSvg(state.plane2, p2Type)}
  ${renderPlaneSvg(state.plane1, p1Type)}
`;
      } else {
        svgContent += `  ${renderPlaneSvg(state.plane1, p1Type)}
  ${renderPlaneSvg(state.plane2, p2Type)}
`;
      }
    } else if (state.graphicType === 'svg') {
      state.uploadedSvgs.forEach((svg) => {
        const x = (svg.x / 100) * width;
        const y = (svg.y / 100) * height;
        let cleanContent = svg.content
          .replace(/<\?xml.*?\?>/g, '')
          .replace(/<!DOCTYPE.*?>/g, '')
          .trim();
        const sx = svg.flipH ? -svg.scale : svg.scale;
        const sy = svg.flipV ? -svg.scale : svg.scale;
        svgContent += `  <g transform="translate(${x}, ${y}) rotate(${svg.rotation}) scale(${sx}, ${sy}) translate(-50, -50)">${cleanContent}</g>
`;
      });
    }

    const areaAX = AREA_A.x - 13;
    const areaAY = AREA_A.y - 10;
    let currentY = areaAY;

    if (state.showMainEn) {
      state.mainEnText.split('\n').forEach((line) => {
        const y = currentY + state.mainEnSize * 0.8 + MAIN_EN_OFFSET_Y;
        svgContent += `  <text x="${
          areaAX
        }" y="${y}" style="font-family: ${getFontFamily(
          state.mainEnWeight,
          true,
        )}; font-size: ${
          state.mainEnSize
        }px; font-weight: normal; letter-spacing: -0.04em; text-transform: uppercase;" fill="#000">${escapeXml(line)}</text>
`;
        currentY += state.mainEnSize * state.mainEnLineHeight;
      });
    }
    if (state.showMainZh) {
      if (state.showMainEn) currentY += state.titleGap;
      const zhLines = state.mainZhText
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .split('\n');
      const baseY = currentY + state.mainZhSize * 0.85;
      svgContent += `  <text x="${areaAX + 10}" y="${baseY}" style="font-family: ${getFontFamily(
        state.mainZhWeight,
        true,
      )}; font-size: ${state.mainZhSize}px; font-weight: normal; letter-spacing: 0.02em;" fill="#000">
`;
      zhLines.forEach((ln, i) => {
        const dy = i === 0 ? 0 : state.mainZhSize * state.mainZhLineHeight;
        svgContent += `    <tspan x="${areaAX + 10}" dy="${dy}">${escapeXml(
          ln,
        )}</tspan>
`;
      });
      svgContent += `  </text>
`;
    }

    // 区域B：始终覆盖图形设计部分（与预览一致：背景色遮罩在图形之上、文字之下）
    svgContent += `  <rect x="0" y="${height - AREA_B.h}" width="${width}" height="${AREA_B.h}" fill="${state.bgColor}" />
`;

    const padX = 50;
    const padY = 28;
    const bottomY = height - padY;

    // 副标题1：左侧，底对齐 + 偏移
    const sub1Lines = state.sub1Text
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n');
    const sub1Step = state.sub1Size * 1.2;
    sub1Lines.forEach((line, i) => {
      const yAfterEdge =
        bottomY +
        SUB1_OFFSET_Y -
        (sub1Lines.length - 1 - i) * sub1Step;
      // AI 对 dominant-baseline 的支持不稳定：副标题1用“baseline 补偿”方式更接近预览
      const y = yAfterEdge - state.sub1Size * 0.18;
      svgContent += `  <text x="${padX}" y="${y}" style="font-family: ${getFontFamily(
        state.sub1Weight,
        true,
      )}; font-size: ${state.sub1Size}px; font-weight: normal;" fill="#000">${escapeXml(
        line,
      )}</text>
`;
    });

    // 副标题2：右侧，最多两行，行距 1.1，底对齐 + 偏移
    const sub2Lines = keepMaxLines(state.sub2Text, 2)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n');
    const sub2Step = state.sub2Size * 1.1;
    sub2Lines.forEach((line, i) => {
      const y =
        bottomY +
        SUB2_OFFSET_Y -
        (sub2Lines.length - 1 - i) * sub2Step;
      svgContent += `  <text x="${width - padX}" y="${y}" dominant-baseline="text-after-edge" style="font-family: ${getFontFamily(
        state.sub2Weight,
        true,
      )}; font-size: ${state.sub2Size}px; font-weight: normal; text-anchor: end;" fill="#000">${escapeXml(
        line,
      )}</text>
`;
    });

    // Logo：始终在最上层（与预览一致：右上 50px 参考线对齐）
    if (state.logoSvg) {
      const logoX = width - 50 - LOGO_BOX.w;
      const logoY = 50;
      svgContent += inlineXhsLogoForExport(
        state.logoSvg,
        logoX,
        logoY,
        LOGO_BOX.w,
        LOGO_BOX.h,
      );
    }

    svgContent += `</svg>`;
    download(
      new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' }),
      'layout-design.svg',
    );
    setToast('已导出 SVG');
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const resetAll = () => {
    localStorage.removeItem('simplelayout_settings');
    setState({
      ...initialLayoutState,
      titleGap: TITLE_GAP_PX,
      mainEnLineHeight: MAIN_EN_LINE_HEIGHT,
      mainZhLineHeight: MAIN_ZH_LINE_HEIGHT,
      logoSvg: DEFAULT_LOGO_SVG,
    });
    setToast('已重置为默认设置');
  };

  const startResizeSidebar = (e: React.MouseEvent) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const minW = 280;
    const maxW = 440;

    const onMove = (ev: MouseEvent) => {
      const next = clamp(startW + (ev.clientX - startX), minW, maxW);
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const DOT_PRESETS: Record<
    'preset1' | 'preset2' | 'preset3',
    { dotCount: number; dotSpread: number; dotX: number; dotY: number; dotRotation: number; dotSeed: number }
  > = {
    // 预设1：左右边缘密集（U型分布），整体下移并收窄厚度，尽量避开 Area A 主标题
    preset1: { dotCount: 48, dotSpread: 14, dotX: 0, dotY: -120, dotRotation: 0, dotSeed: 7382 },
    preset2: { dotCount: 30, dotSpread: 80,  dotX: 80,   dotY: -30, dotRotation: 150, dotSeed: 19204 },
    preset3: { dotCount: 50, dotSpread: 160, dotX: -120, dotY: 60,  dotRotation: 280, dotSeed: 54917 },
  };

  const applyDotPreset = (
    preset: 'preset1' | 'preset2' | 'preset3' | 'preset4' | 'preset5',
  ) => {
    setState((prev) => {
      if (preset === 'preset1') {
        return {
          ...prev,
          dotCount: prev.dotPreset1Count,
          dotSpread: prev.dotPreset1Spread,
          dotSideSpread: prev.dotPreset1SideSpread,
          dotX: prev.dotPreset1X,
          dotY: prev.dotPreset1Y,
          dotRotation: prev.dotPreset1Rotation,
          dotSeed: prev.dotPreset1Seed,
          dotPreset: preset,
        };
      }
      if (preset === 'preset2') {
        return {
          ...prev,
          dotCount: prev.dotPreset2Count,
          dotSpread: prev.dotPreset2Spread,
          dotSideSpread: prev.dotPreset2SideSpread,
          dotX: prev.dotPreset2X,
          dotY: prev.dotPreset2Y,
          dotRotation: prev.dotPreset2Rotation,
          dotSeed: prev.dotPreset2Seed,
          dotPreset: preset,
        };
      }

      if (preset === 'preset3') {
        return {
          ...prev,
          dotCount: prev.dotPreset3Count,
          dotSpread: prev.dotPreset3Spread,
          dotSideSpread: prev.dotPreset3SideSpread,
          dotX: prev.dotPreset3X,
          dotY: prev.dotPreset3Y,
          dotRotation: prev.dotPreset3Rotation,
          dotSeed: prev.dotPreset3Seed,
          dotPreset: preset,
        };
      }

      if (preset === 'preset4') {
        return {
          ...prev,
          dotCount: prev.dotPreset4Count,
          dotSpread: prev.dotPreset4Spread,
          dotSideSpread: prev.dotPreset4SideSpread,
          dotX: prev.dotPreset4X,
          dotY: prev.dotPreset4Y,
          dotRotation: prev.dotPreset4Rotation,
          dotSeed: prev.dotPreset4Seed,
          dotPreset: preset,
        };
      }

      return {
        ...prev,
        dotCount: prev.dotPreset5Count,
        dotSpread: prev.dotPreset5Spread,
        dotSideSpread: prev.dotPreset5SideSpread,
        dotX: prev.dotPreset5X,
        dotY: prev.dotPreset5Y,
        dotRotation: prev.dotPreset5Rotation,
        dotSeed: prev.dotPreset5Seed,
        dotPreset: preset,
      };
    });
  };

  const randomizeDot = () => {
    setState((prev) => ({
      ...prev,
      dotCount:    Math.floor(Math.random() * 56) + 5,
      dotSpread:   Math.floor(Math.random() * 201),
      dotSideSpread: Math.floor(Math.random() * 201) + 100,
      dotX:        Math.floor(Math.random() * 801) - 400,
      dotY:        Math.floor(Math.random() * 501) - 250,
      dotRotation: Math.floor(Math.random() * 361),
      dotSeed:     Math.floor(Math.random() * 100000) + 1,
      dotPreset:   'random',
    }));
    setToast('已随机生成一版点阵');
  };

  const applyLinePreset = (preset: 'preset1' | 'preset2' | 'preset3') => {
    const n = preset.replace('preset', '') as '1' | '2' | '3';
    const key = (field: string) =>
      `linePreset${n}${field}` as keyof typeof state;
    setState((prev) => ({
      ...prev,
      linePreset: preset,
      lineCount: prev[key('Count')] as number,
      lineThickness: prev[key('Thickness')] as number,
      lineLengthContrast: prev[key('LengthContrast')] as number,
      lineSeed: prev[key('Seed')] as number,
      lineX: prev[key('X')] as number,
      lineY: prev[key('Y')] as number,
    }));
  };

  const randomizeLine = () => {
    setState((prev) => ({
      ...prev,
      lineCount: Math.floor(Math.random() * 4) + 2,
      lineThickness: Math.floor(Math.random() * 71) + 10,
      lineLengthContrast: Math.round(Math.random() * 20) / 20,
      lineSeed: Math.floor(Math.random() * 100000) + 1,
      linePreset: 'random',
    }));
    setToast('已随机生成一版线条');
  };

  const quickRandomize = () => {
    setState((prev) => ({
      ...prev,
      dotSeed: Math.floor(Math.random() * 100000) + 1,
      lineSeed: Math.floor(Math.random() * 100000) + 1,
      planeSeed: Math.floor(Math.random() * 100000) + 1,
      dotRotation: Math.floor(Math.random() * 360),
      dotSideSpread: Math.floor(Math.random() * 201) + 100,
      dotPreset: 'random' as const,
    }));
    setToast('已随机生成一版');
  };

  const availableGraphicColors =
    (DOT_COLORS[state.bgColor] || DOT_COLORS['#ffffff']).filter(
      (c) => c !== state.bgColor,
    );
  const planeShapes = useMemo(
    () => computePlaneShapes(state.planeShape, state.planeSeed),
    [state.planeShape, state.planeSeed],
  );

  const randInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;
  const randFloat = (min: number, max: number) => Math.random() * (max - min) + min;

  const pickDifferentColor = (exclude: string) => {
    const alt = availableGraphicColors.find((c) => c !== exclude);
    return alt || exclude;
  };

  const updatePlane = (
    which: 'plane1' | 'plane2',
    patch: Partial<PlaneConfig>,
  ) => {
    setState((prev) => ({
      ...prev,
      [which]: { ...(prev as any)[which], ...patch },
    }));
  };

  const setPlaneColor = (which: 'plane1' | 'plane2', color: string) => {
    if (availableGraphicColors.length < 2) {
      setToast('可选颜色不足，无法让两个图形不同色');
      return;
    }
    setState((prev) => {
      const otherKey = which === 'plane1' ? 'plane2' : 'plane1';
      const nextThis = { ...(prev as any)[which], color };
      const other = { ...(prev as any)[otherKey] };
      if (other.color === color) {
        other.color = pickDifferentColor(color);
      }
      return {
        ...prev,
        [which]: nextThis,
        [otherKey]: other,
      } as LayoutState;
    });
  };

  // 保证两个图形不同色（例如背景色切换导致可选色变化）
  useEffect(() => {
    if (availableGraphicColors.length < 2) return;
    setState((prev) => {
      const c1 = prev.plane1.color;
      const c2 = prev.plane2.color;
      if (c1 !== c2) return prev;
      const next2 = pickDifferentColor(c1);
      if (next2 === c2) return prev;
      return { ...prev, plane2: { ...prev.plane2, color: next2 } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bgColor]);

  const applyPlanePreset = (preset: 'preset1' | 'preset2' | 'preset3') => {
    const idx = parseInt(preset.replace('preset', '')) - 1;
    const shape = state.planeShape;
    const presetKey = (
      shape === 'square' ? 'squarePlanePresets'
      : shape === 'circle' ? 'circlePlanePresets'
      : shape === 'triangle' ? 'trianglePlanePresets'
      : 'randomPlanePresets'
    ) as keyof typeof state;
    const presetActiveKey = (
      shape === 'square' ? 'squarePlanePreset'
      : shape === 'circle' ? 'circlePlanePreset'
      : shape === 'triangle' ? 'trianglePlanePreset'
      : 'randomPlanePreset'
    ) as keyof typeof state;
    setState((prev) => {
      const presets = prev[presetKey] as import('./types').PlanePresetConfig[];
      const cfg = presets[idx];
      if (!cfg) return prev;
      return {
        ...prev,
        [presetActiveKey]: preset,
        plane1: {
          ...cfg.plane1,
          color: cfg.plane1.color,
        },
        plane2: {
          ...cfg.plane2,
          color: cfg.plane2.color,
        },
        planeOrder: cfg.planeOrder,
        planeSeed: cfg.planeSeed,
      };
    });
  };

  const randomizePlanes = () => {
    const nextSeed = Math.floor(Math.random() * 100000) + 1;
    const nextShapes = computePlaneShapes(state.planeShape, nextSeed);
    const getActiveShape = (
      which: 'plane1' | 'plane2',
    ): 'square' | 'circle' | 'triangle' => {
      if (state.planeShape === 'random') {
        return which === 'plane1' ? nextShapes.s1 : nextShapes.s2;
      }
      return state.planeShape;
    };

    const mkPlane = (
      which: 'plane1' | 'plane2',
      prev: PlaneConfig,
    ): PlaneConfig => {
      const shape = getActiveShape(which);
      const x = randInt(18, 82);
      const y = randInt(18, 82);
      const angle = Math.round(randFloat(-25, 25));
      if (shape === 'square') {
        const width = randInt(420, 1600);
        const height = randInt(320, 1200);
        return { ...prev, type: 'square', width, height, x, y, angle };
      }
      if (shape === 'circle') {
        const rx = randInt(180, 720);
        const ry = randInt(140, 560);
        return { ...prev, type: 'circle', width: rx * 2, height: ry * 2, x, y, angle };
      }
      // triangle / polygon
      const sides = randInt(3, 9);
      const radius = randInt(200, 650);
      return { ...prev, type: 'triangle', sides, radius, x, y, angle };
    };

    setState((prev) => {
      let c1: string;
      let c2: string;

      if (
        prev.planeShape === 'square' ||
        prev.planeShape === 'circle' ||
        prev.planeShape === 'triangle' ||
        prev.planeShape === 'random'
      ) {
        // 所有面形状模式下：只允许这 3 种“两色组合”
        const pairs = [
          { a: '#9e76ff', b: '#ffdf7a' }, // 预设1
          { a: '#985946', b: '#9e76ff' }, // 预设2
          { a: '#9e76ff', b: '#ffdf7a' }, // 预设3
        ] as const;

        // 如果背景色是浅紫色（#dfd9ff），随机时避开生成同色，避免“看不见/混入背景”
        // （同时对其它背景色也做一致的兜底判断）
        const bg = prev.bgColor;
        const safePairs = pairs.filter((p) => p.a !== bg && p.b !== bg);
        const pickFrom = safePairs.length ? safePairs : pairs;
        const pick = pickFrom[randInt(0, pickFrom.length - 1)];
        c1 = pick.a;
        c2 = pick.b;

        // 最强兜底：再检查一次，避免因为其它逻辑导致仍抽到 bgColor
        if (c1 === bg || c2 === bg) {
          const fallback = pickFrom[0] ?? pairs[0];
          c1 = fallback.a;
          c2 = fallback.b;
        }
      } else {
        const colors = (DOT_COLORS[prev.bgColor] || DOT_COLORS['#ffffff']).filter(
          (c) => c !== prev.bgColor,
        );
        if (colors.length < 1) return prev;

        c1 = colors[randInt(0, colors.length - 1)];
        c2 = colors.length >= 2 ? pickDifferentColor(c1) : c1;
      }
      const shapePresetKey = (
        prev.planeShape === 'square' ? 'squarePlanePreset'
        : prev.planeShape === 'circle' ? 'circlePlanePreset'
        : prev.planeShape === 'triangle' ? 'trianglePlanePreset'
        : 'randomPlanePreset'
      ) as keyof typeof prev;

      return {
        ...prev,
        [shapePresetKey]: 'random',
        planeSeed: nextSeed,
        plane1: { ...mkPlane('plane1', prev.plane1), color: c1 },
        plane2: { ...mkPlane('plane2', prev.plane2), color: c2 },
      };
    });
    setToast('已随机生成一版图形');
  };

  return (
    <div className="min-h-screen h-screen overflow-hidden font-sans bg-slate-50">
      {/* mobile: edit/preview switch */}
      <div className="md:hidden h-full">
        {mobileView === 'preview' ? (
          <div className="h-full flex flex-col">
            <div className="px-5 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMobileView('edit')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-100 text-slate-900 text-[12px] font-black"
              >
                <ArrowLeft size={16} />
                返回编辑
              </button>
              <div className="text-[12px] font-black text-slate-800">
                预览（{Math.round(scale * 100)}%）
              </div>
              <button
                type="button"
                onClick={() => exportImage('png')}
                disabled={isExporting}
                className="px-3 py-2 rounded-2xl bg-[#9e76ff] text-white text-[12px] font-black disabled:opacity-60"
              >
                导出 PNG
              </button>
            </div>

            <main
              className="flex-1 bg-slate-200 relative overflow-hidden flex items-center justify-center p-4"
              ref={scalerRef}
            >
              <div
                ref={mobileViewportRef}
                className="w-full h-full flex items-center justify-center overflow-hidden"
              >
                <div
                  className="relative shrink-0"
                  style={{
                    width: `${ARTBOARD_W * scale}px`,
                    height: `${ARTBOARD_H * scale}px`,
                  }}
                >
                  <div
                    ref={artboardRef}
                    className="shadow-2xl absolute inset-0 overflow-hidden transition-transform duration-100"
                    style={{
                      width: `${ARTBOARD_W}px`,
                      height: `${ARTBOARD_H}px`,
                      backgroundColor: state.bgColor,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                {state.graphicType === 'line' && <LineLayer state={state} />}
                {state.graphicType === 'plane' && <PlaneLayer state={state} />}

                <GuidesLayer visible={state.showGuides} />

                {/* Logo 区域（仅作为预留位置；有 logoSvg 时显示） */}
                <div
                  className="absolute z-[200]"
                  style={{
                    left: `${ARTBOARD_W - 50 - LOGO_BOX.w}px`,
                    top: '50px',
                    width: `${LOGO_BOX.w}px`,
                    height: `${LOGO_BOX.h}px`,
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state.logoSvg ? (
                    <img
                      className="w-full h-full object-contain"
                      src={svgToDataUri(state.logoSvg)}
                      alt="logo"
                      draggable={false}
                    />
                  ) : null}
                </div>

                {/* 区域A：主标题限制区域（裁切） */}
                <div
                  className="absolute z-30 pointer-events-none overflow-hidden"
                  style={{
                    left: `${AREA_A.x}px`,
                    top: `${AREA_A.y}px`,
                    width: `${AREA_A.w}px`,
                    height: `${AREA_A.h}px`,
                  }}
                >
                  <div
                    className="flex flex-col"
                    style={{ gap: `${state.titleGap}px` }}
                  >
                    {state.showMainEn && (
                      <div
                        style={{
                          fontSize: `${state.mainEnSize}px`,
                          fontFamily: getFontFamily(state.mainEnWeight),
                          lineHeight: state.mainEnLineHeight,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                          transform: `translateY(${MAIN_EN_OFFSET_Y}px)`,
                        }}
                      >
                        {state.mainEnText}
                      </div>
                    )}
                    {state.showMainZh && (
                      <div
                        style={{
                          fontSize: `${state.mainZhSize}px`,
                          fontFamily: getFontFamily(state.mainZhWeight),
                          lineHeight: state.mainZhLineHeight,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {state.mainZhText}
                      </div>
                    )}
                  </div>
                </div>

                {state.graphicType === 'dot' && <DotLayer state={state} />}
                {state.graphicType === 'svg' && (
                  <SvgLayer state={state} updateSvg={updateSvg} />
                )}

                {/* 区域B：始终覆盖图形设计部分 */}
                <div
                  className="absolute left-0 bottom-0 w-full z-50 px-[50px] flex items-end justify-between"
                  style={{
                    height: `${AREA_B.h}px`,
                    paddingBottom: '28px',
                    paddingTop: '28px',
                    backgroundColor: state.bgColor,
                  }}
                >
                  <div
                    style={{
                      fontSize: `${SUB1_SIZE_PX}px`,
                      fontFamily: getFontFamily(state.sub1Weight),
                      whiteSpace: 'pre-line',
                      transform: `translateY(${SUB1_OFFSET_Y}px)`,
                    }}
                  >
                    {state.sub1Text}
                  </div>
                  <div
                    className="text-right"
                    style={{
                      fontSize: `${SUB2_SIZE_PX}px`,
                      fontFamily: getFontFamily(state.sub2Weight),
                      whiteSpace: 'pre-line',
                      lineHeight: 1.1,
                      transform: `translateY(${SUB2_OFFSET_Y}px)`,
                    }}
                  >
                    {keepMaxLines(state.sub2Text, 2)}
                  </div>
                </div>
              </div>
                </div>
              </div>
            </main>
          </div>
        ) : (
          <aside className="h-full flex flex-col">
            <AppShellHeader
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onPreview={() => setMobileView('preview')}
            />

            <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-hide">
              <AnimatePresence mode="wait">
                {activeTab === 'typography' && (
                  <motion.div
                    key="typography"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="space-y-4"
                  >
                    <PanelCard
                      title="版式规范（全局参考）"
                      icon={<Info size={16} />}
                    >
                      <div className="space-y-3">
                        <Toggle
                          checked={state.showGuides}
                          onChange={(v) => updateState('showGuides', v)}
                          label="显示参考线"
                        />
                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                          <div className="text-[12px] font-black text-slate-800">
                            排版注意事项
                          </div>
                          <div className="mt-2 space-y-1 text-[12px] text-slate-600 leading-relaxed">
                            <div>1. 中英文字体统一使用兰亭黑。</div>
                            <div>2. 主标题文字整体范围控制在区域A中，且整体行数建议为3行。</div>
                            <div>3. 画布尺寸为1920*900 像素。</div>
                          </div>
                        </div>
                      </div>
                    </PanelCard>

                    <div>
                      <PanelCard title="中英标题间距" icon={<Settings2 size={16} />}>
                        <Slider
                          label="间距"
                          min={0}
                          max={60}
                          step={1}
                          value={state.titleGap}
                          onChange={(v) => updateState('titleGap', v)}
                          unit="px"
                        />
                      </PanelCard>

                      <PanelCard
                        title="主标题"
                        icon={<Type size={16} />}
                      >
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <FieldLabel label="文本内容" hint="支持换行" />
                            <textarea
                              value={state.mainMixedText}
                              onChange={(e) =>
                                setMainMixedText(e.target.value)
                              }
                              className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-[13px] font-bold min-h-[96px] focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                            />
                          </div>
                          <Slider
                            label="字号"
                            min={MAIN_EN_SIZE_MIN}
                            max={MAIN_EN_SIZE_MAX}
                            step={5}
                            value={state.mainEnSize}
                            onChange={setMainEnSizeSynced}
                            unit="px"
                          />
                          {/* 主标题粗细固定为粗黑(700)，界面不再提供调整入口 */}
                          {/* 行距固定：不在界面显示 */}
                        </div>
                      </PanelCard>

                      {false && (
                        <PanelCard
                          title="主标题（中文）"
                        icon={<Type size={16} />}
                        right={
                          <div className="flex items-center gap-2">
                            <IconToggle
                              on={state.showMainZh}
                              onClick={() => updateState('showMainZh', !state.showMainZh)}
                              iconOn={<Eye size={16} />}
                              iconOff={<EyeOff size={16} />}
                              label="显示/隐藏（中文）"
                            />
                            <IconToggle
                              on={state.isSizeLinked}
                              onClick={() => updateState('isSizeLinked', !state.isSizeLinked)}
                              iconOn={<Lock size={16} />}
                              iconOff={<Unlock size={16} />}
                              label="联动锁（中英字号）"
                              disabled={!(state.showMainEn && state.showMainZh)}
                            />
                          </div>
                        }
                        >
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <FieldLabel label="文本内容" />
                            <textarea
                              value={state.mainZhText}
                              onChange={(e) =>
                                updateState('mainZhText', e.target.value)
                              }
                              className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-[13px] font-bold min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                            />
                          </div>
                          <Slider
                            label="字号"
                            hint={
                              state.showMainEn && state.showMainZh
                                ? '中英同时显示时与英文联动'
                                : undefined
                            }
                            min={MAIN_ZH_SIZE_MIN}
                            max={MAIN_ZH_SIZE_MAX}
                            step={5}
                            value={state.mainZhSize}
                            disabled={state.showMainEn && state.showMainZh && state.isSizeLinked}
                            onChange={setMainZhSizeSynced}
                            unit="px"
                          />
                          {state.showMainEn && state.showMainZh && (
                            <div className="text-[12px] text-slate-500">
                              {state.isSizeLinked
                                ? '联动开启：调整任意一个字号都会同步'
                                : '联动关闭：可分别调整中/英字号'}
                            </div>
                          )}
                          <Segmented
                            value={
                              (state.mainZhWeight >= 700
                                ? '700'
                                : state.mainZhWeight >= 600
                                ? '600'
                                : '500') as '500' | '600' | '700'
                            }
                            onChange={(v) =>
                              updateState('mainZhWeight', Number(v))
                            }
                            options={[
                              { value: '500', label: '中黑' },
                              { value: '600', label: '粗黑' },
                              { value: '700', label: '粗黑+' },
                            ]}
                          />
                          {/* 行距固定：不在界面显示 */}
                        </div>
                        </PanelCard>
                      )}

                      <PanelCard title="副标题（区域 B）" icon={<Check size={16} />}>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <FieldLabel label="副标题1" hint="时间" />
                            <input
                              value={state.sub1Text}
                              onChange={(e) =>
                                updateState('sub1Text', e.target.value)
                              }
                              className="w-full bg-white border border-slate-200 rounded-2xl px-3 py-2.5 text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                            />
                          </div>
                          <div className="space-y-2">
                            <FieldLabel label="副标题2" hint="最多两行" />
                            <textarea
                              value={state.sub2Text}
                              onChange={(e) =>
                                updateState('sub2Text', keepMaxLines(e.target.value, 2))
                              }
                              className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-[13px] font-bold min-h-[88px] focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                            />
                          </div>
                        </div>
                      </PanelCard>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'graphic' && (
                  <motion.div
                    key="graphic"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-4"
                  >
                    <PanelCard title="背景与图形" icon={<Palette size={16} />}>
                      <div className="space-y-3">
                        <FieldLabel label="背景颜色选择" />
                        <div className="grid grid-cols-2 gap-2">
                          {(['#ffffff', '#dfd9ff'] as const).map((c) => (
                            <button
                              key={c}
                              onClick={() => updateState('bgColor', c)}
                              className={cx(
                                'rounded-2xl border px-3 py-2.5 text-[12px] font-black transition flex items-center justify-center gap-2',
                                state.bgColor === c
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'bg-white border-slate-200',
                              )}
                            >
                              <span
                                className="w-4 h-4 rounded-md border border-slate-200"
                                style={{ backgroundColor: c }}
                              />
                              {c === '#ffffff' ? '纯白' : '浅紫'}
                            </button>
                          ))}
                        </div>

                        <FieldLabel label="图形元素方向（单选）" />
                        <Segmented
                          value={state.graphicType}
                          onChange={(v) => updateState('graphicType', v)}
                          options={[
                            { value: 'dot', label: '点' },
                            { value: 'line', label: '线' },
                            { value: 'plane', label: '面' },
                            { value: 'svg', label: '手动上传' },
                          ]}
                        />
                      </div>
                    </PanelCard>

                    {state.graphicType === 'dot' && (
                      <PanelCard
                        title="点阵"
                        icon={<Shuffle size={16} />}
                      >
                        <div className="space-y-4">
                          <FieldLabel label="图形形状" />
                          <Segmented
                            value={state.dotShape}
                            onChange={(v) => updateState('dotShape', v)}
                            options={[
                              { value: 'circle', label: '圆形' },
                              { value: 'triangle', label: '三角形' },
                              { value: 'square', label: '正方形' },
                              { value: 'random', label: '图形随机' },
                            ]}
                          />

                          <ColorDots
                            label="颜色色盘选择"
                            colors={availableGraphicColors}
                            selected={state.dotColors.length ? state.dotColors : [availableGraphicColors[0]]}
                            onToggle={(c) => {
                              const curr = state.dotColors.length
                                ? state.dotColors
                                : [availableGraphicColors[0]];
                              const next = curr.includes(c)
                                ? curr.filter((x) => x !== c)
                                : [...curr, c];
                              updateState('dotColors', next.length ? next : [c]);
                            }}
                          />

                          <FieldLabel label="布局预设" />
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                'preset1',
                                'preset2',
                                'preset3',
                              ] as const
                            ).map((p, i) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => applyDotPreset(p)}
                                className={cx(
                                  'rounded-2xl border py-2.5 text-[12px] font-black transition',
                                  state.dotPreset === p
                                    ? 'border-[#9e76ff] bg-[#9e76ff]/10 text-[#9e76ff]'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-[#9e76ff]/40',
                                )}
                              >
                                {p === 'preset1'
                                  ? '预设 1'
                                  : p === 'preset2'
                                    ? '预设 2'
                                    : '预设 3'}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-3 pt-2 hidden">
                            <div
                              className={cx(
                                'rounded-2xl border p-3 space-y-3',
                                state.dotPreset === 'preset1'
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-black">预设 1</div>
                                {state.dotPreset === 'preset1' && (
                                  <div className="text-[11px] font-black text-[#9e76ff]">
                                    已选中
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="数量"
                                  min={5}
                                  max={80}
                                  step={1}
                                  value={state.dotPreset1Count}
                                  onChange={(v) => {
                                    updateState('dotPreset1Count', v);
                                    if (state.dotPreset === 'preset1') {
                                      updateState('dotCount', v);
                                    }
                                  }}
                                />
                                <Slider
                                  label="分散"
                                  min={0}
                                  max={200}
                                  step={1}
                                  value={state.dotPreset1Spread}
                                  onChange={(v) => {
                                    updateState('dotPreset1Spread', v);
                                    if (state.dotPreset === 'preset1') {
                                      updateState('dotSpread', v);
                                    }
                                  }}
                                />
                              </div>

                              <Slider
                                label="左右分散"
                                min={0}
                                max={400}
                                step={1}
                                value={state.dotPreset1SideSpread}
                                onChange={(v) => {
                                  updateState('dotPreset1SideSpread', v);
                                  if (state.dotPreset === 'preset1') {
                                    updateState('dotSideSpread', v);
                                  }
                                }}
                                unit="%"
                              />

                              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                                <Slider
                                  label="偏移 X"
                                  min={-400}
                                  max={400}
                                  step={5}
                                  value={state.dotPreset1X}
                                  onChange={(v) => {
                                    updateState('dotPreset1X', v);
                                    if (state.dotPreset === 'preset1') {
                                      updateState('dotX', v);
                                    }
                                  }}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="偏移 Y"
                                  min={-250}
                                  max={250}
                                  step={5}
                                  value={state.dotPreset1Y}
                                  onChange={(v) => {
                                    updateState('dotPreset1Y', v);
                                    if (state.dotPreset === 'preset1') {
                                      updateState('dotY', v);
                                    }
                                  }}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="旋转"
                                  min={0}
                                  max={360}
                                  step={1}
                                  value={state.dotPreset1Rotation}
                                  onChange={(v) => {
                                    updateState('dotPreset1Rotation', v);
                                    if (state.dotPreset === 'preset1') {
                                      updateState('dotRotation', v);
                                    }
                                  }}
                                  unit="°"
                                  compact
                                />
                              </div>
                            </div>

                            <div
                              className={cx(
                                'rounded-2xl border p-3 space-y-3',
                                state.dotPreset === 'preset2'
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-black">预设 2</div>
                                {state.dotPreset === 'preset2' && (
                                  <div className="text-[11px] font-black text-[#9e76ff]">
                                    已选中
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="数量"
                                  min={5}
                                  max={80}
                                  step={1}
                                  value={state.dotPreset2Count}
                                  onChange={(v) => {
                                    updateState('dotPreset2Count', v);
                                    if (state.dotPreset === 'preset2') {
                                      updateState('dotCount', v);
                                    }
                                  }}
                                />
                                <Slider
                                  label="分散"
                                  min={0}
                                  max={200}
                                  step={1}
                                  value={state.dotPreset2Spread}
                                  onChange={(v) => {
                                    updateState('dotPreset2Spread', v);
                                    if (state.dotPreset === 'preset2') {
                                      updateState('dotSpread', v);
                                    }
                                  }}
                                />
                              </div>

                              <Slider
                                label="左右分散"
                                min={0}
                                max={400}
                                step={1}
                                value={state.dotPreset2SideSpread}
                                onChange={(v) => {
                                  updateState('dotPreset2SideSpread', v);
                                  if (state.dotPreset === 'preset2') {
                                    updateState('dotSideSpread', v);
                                  }
                                }}
                                unit="%"
                              />

                              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                                <Slider
                                  label="偏移 X"
                                  min={-400}
                                  max={400}
                                  step={5}
                                  value={state.dotPreset2X}
                                  onChange={(v) => {
                                    updateState('dotPreset2X', v);
                                    if (state.dotPreset === 'preset2') {
                                      updateState('dotX', v);
                                    }
                                  }}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="偏移 Y"
                                  min={-250}
                                  max={250}
                                  step={5}
                                  value={state.dotPreset2Y}
                                  onChange={(v) => {
                                    updateState('dotPreset2Y', v);
                                    if (state.dotPreset === 'preset2') {
                                      updateState('dotY', v);
                                    }
                                  }}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="旋转"
                                  min={0}
                                  max={360}
                                  step={1}
                                  value={state.dotPreset2Rotation}
                                  onChange={(v) => {
                                    updateState('dotPreset2Rotation', v);
                                    if (state.dotPreset === 'preset2') {
                                      updateState('dotRotation', v);
                                    }
                                  }}
                                  unit="°"
                                  compact
                                />
                              </div>
                            </div>

                            <div
                              className={cx(
                                'rounded-2xl border p-3 space-y-3',
                                state.dotPreset === 'preset3'
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-black">预设 3</div>
                                {state.dotPreset === 'preset3' && (
                                  <div className="text-[11px] font-black text-[#9e76ff]">
                                    已选中
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="数量"
                                  min={5}
                                  max={80}
                                  step={1}
                                  value={state.dotPreset3Count}
                                  onChange={(v) => {
                                    updateState('dotPreset3Count', v);
                                    if (state.dotPreset === 'preset3') {
                                      updateState('dotCount', v);
                                    }
                                  }}
                                />
                                <Slider
                                  label="分散"
                                  min={0}
                                  max={200}
                                  step={1}
                                  value={state.dotPreset3Spread}
                                  onChange={(v) => {
                                    updateState('dotPreset3Spread', v);
                                    if (state.dotPreset === 'preset3') {
                                      updateState('dotSpread', v);
                                    }
                                  }}
                                />
                              </div>

                              <Slider
                                label="左右分散"
                                min={0}
                                max={400}
                                step={1}
                                value={state.dotPreset3SideSpread}
                                onChange={(v) => {
                                  updateState('dotPreset3SideSpread', v);
                                  if (state.dotPreset === 'preset3') {
                                    updateState('dotSideSpread', v);
                                  }
                                }}
                                unit="%"
                              />

                              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                                <Slider
                                  label="偏移 X"
                                  min={-400}
                                  max={400}
                                  step={5}
                                  value={state.dotPreset3X}
                                  onChange={(v) => {
                                    updateState('dotPreset3X', v);
                                    if (state.dotPreset === 'preset3') {
                                      updateState('dotX', v);
                                    }
                                  }}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="偏移 Y"
                                  min={-250}
                                  max={250}
                                  step={5}
                                  value={state.dotPreset3Y}
                                  onChange={(v) => {
                                    updateState('dotPreset3Y', v);
                                    if (state.dotPreset === 'preset3') {
                                      updateState('dotY', v);
                                    }
                                  }}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="旋转"
                                  min={0}
                                  max={360}
                                  step={1}
                                  value={state.dotPreset3Rotation}
                                  onChange={(v) => {
                                    updateState('dotPreset3Rotation', v);
                                    if (state.dotPreset === 'preset3') {
                                      updateState('dotRotation', v);
                                    }
                                  }}
                                  unit="°"
                                  compact
                                />
                              </div>
                            </div>
                          </div>

                          <div
                            className={cx(
                              'rounded-2xl border p-3 space-y-3 hidden',
                              state.dotPreset === 'preset4'
                                ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                : 'border-slate-200 bg-white',
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-[12px] font-black">预设 4</div>
                              {state.dotPreset === 'preset4' && (
                                <div className="text-[11px] font-black text-[#9e76ff]">
                                  已选中
                                </div>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <Slider
                                label="数量"
                                min={5}
                                max={80}
                                step={1}
                                value={state.dotPreset4Count}
                                onChange={(v) => {
                                  updateState('dotPreset4Count', v);
                                  if (state.dotPreset === 'preset4') {
                                    updateState('dotCount', v);
                                  }
                                }}
                              />
                              <Slider
                                label="分散"
                                min={0}
                                max={200}
                                step={1}
                                value={state.dotPreset4Spread}
                                onChange={(v) => {
                                  updateState('dotPreset4Spread', v);
                                  if (state.dotPreset === 'preset4') {
                                    updateState('dotSpread', v);
                                  }
                                }}
                              />
                            </div>

                            <Slider
                              label="左右分散"
                              min={0}
                              max={400}
                              step={1}
                              value={state.dotPreset4SideSpread}
                              onChange={(v) => {
                                updateState('dotPreset4SideSpread', v);
                                if (state.dotPreset === 'preset4') {
                                  updateState('dotSideSpread', v);
                                }
                              }}
                              unit="%"
                            />

                            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                              <Slider
                                label="偏移 X"
                                min={-400}
                                max={400}
                                step={5}
                                value={state.dotPreset4X}
                                onChange={(v) => {
                                  updateState('dotPreset4X', v);
                                  if (state.dotPreset === 'preset4') {
                                    updateState('dotX', v);
                                  }
                                }}
                                unit="px"
                                compact
                              />
                              <Slider
                                label="偏移 Y"
                                min={-250}
                                max={250}
                                step={5}
                                value={state.dotPreset4Y}
                                onChange={(v) => {
                                  updateState('dotPreset4Y', v);
                                  if (state.dotPreset === 'preset4') {
                                    updateState('dotY', v);
                                  }
                                }}
                                unit="px"
                                compact
                              />
                              <Slider
                                label="旋转"
                                min={0}
                                max={360}
                                step={1}
                                value={state.dotPreset4Rotation}
                                onChange={(v) => {
                                  updateState('dotPreset4Rotation', v);
                                  if (state.dotPreset === 'preset4') {
                                    updateState('dotRotation', v);
                                  }
                                }}
                                unit="°"
                                compact
                              />
                            </div>
                          </div>

                          <div
                            className={cx(
                              'rounded-2xl border p-3 space-y-3 hidden',
                              state.dotPreset === 'preset5'
                                ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                : 'border-slate-200 bg-white',
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-[12px] font-black">预设 5</div>
                              {state.dotPreset === 'preset5' && (
                                <div className="text-[11px] font-black text-[#9e76ff]">
                                  已选中
                                </div>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <Slider
                                label="数量"
                                min={5}
                                max={80}
                                step={1}
                                value={state.dotPreset5Count}
                                onChange={(v) => {
                                  updateState('dotPreset5Count', v);
                                  if (state.dotPreset === 'preset5') {
                                    updateState('dotCount', v);
                                  }
                                }}
                              />
                              <Slider
                                label="分散"
                                min={0}
                                max={200}
                                step={1}
                                value={state.dotPreset5Spread}
                                onChange={(v) => {
                                  updateState('dotPreset5Spread', v);
                                  if (state.dotPreset === 'preset5') {
                                    updateState('dotSpread', v);
                                  }
                                }}
                              />
                            </div>

                            <Slider
                              label="左右分散"
                              min={0}
                              max={400}
                              step={1}
                              value={state.dotPreset5SideSpread}
                              onChange={(v) => {
                                updateState('dotPreset5SideSpread', v);
                                if (state.dotPreset === 'preset5') {
                                  updateState('dotSideSpread', v);
                                }
                              }}
                              unit="%"
                            />

                            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                              <Slider
                                label="偏移 X"
                                min={-400}
                                max={400}
                                step={5}
                                value={state.dotPreset5X}
                                onChange={(v) => {
                                  updateState('dotPreset5X', v);
                                  if (state.dotPreset === 'preset5') {
                                    updateState('dotX', v);
                                  }
                                }}
                                unit="px"
                                compact
                              />
                              <Slider
                                label="偏移 Y"
                                min={-250}
                                max={250}
                                step={5}
                                value={state.dotPreset5Y}
                                onChange={(v) => {
                                  updateState('dotPreset5Y', v);
                                  if (state.dotPreset === 'preset5') {
                                    updateState('dotY', v);
                                  }
                                }}
                                unit="px"
                                compact
                              />
                              <Slider
                                label="旋转"
                                min={0}
                                max={360}
                                step={1}
                                value={state.dotPreset5Rotation}
                                onChange={(v) => {
                                  updateState('dotPreset5Rotation', v);
                                  if (state.dotPreset === 'preset5') {
                                    updateState('dotRotation', v);
                                  }
                                }}
                                unit="°"
                                compact
                              />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={randomizeDot}
                            className="w-full mt-1 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black shadow-sm hover:bg-[#7e49f4] transition"
                          >
                            随机生成
                          </button>
                        </div>
                      </PanelCard>
                    )}

                    {state.graphicType === 'line' && (
                      <PanelCard title="线条" icon={<Shuffle size={16} />}>
                        <div className="space-y-4">
                          <div className="flex gap-2">
                            {(['preset1', 'preset2', 'preset3'] as const).map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => applyLinePreset(p)}
                                className={cx(
                                  'flex-1 py-2 rounded-xl text-[12px] font-black transition border',
                                  state.linePreset === p
                                    ? 'bg-[#9e76ff] text-white border-[#9e76ff]'
                                    : 'bg-white text-[#9e76ff] border-[#9e76ff]/40 hover:border-[#9e76ff]',
                                )}
                              >
                                预设 {p.replace('preset', '')}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-3 hidden">
                            {/* 预设1 控制器 */}
                            <div
                              className={cx(
                                'rounded-2xl border p-3 space-y-3',
                                state.linePreset === 'preset1'
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-black">预设 1</div>
                                {state.linePreset === 'preset1' && (
                                  <div className="text-[11px] font-black text-[#9e76ff]">已选中</div>
                                )}
                              </div>
                              <div className="grid grid-cols-3 gap-3">
                                <Slider label="条数" min={2} max={5} step={1} value={state.linePreset1Count}
                                  onChange={(v) => { updateState('linePreset1Count', v); if (state.linePreset === 'preset1') updateState('lineCount', v); }} compact />
                                <Slider label="厚度" min={10} max={80} step={1} value={state.linePreset1Thickness}
                                  onChange={(v) => { updateState('linePreset1Thickness', v); if (state.linePreset === 'preset1') updateState('lineThickness', v); }} unit="px" compact />
                                <Slider label="长度对比" min={0} max={1} step={0.05} value={state.linePreset1LengthContrast}
                                  onChange={(v) => { updateState('linePreset1LengthContrast', v); if (state.linePreset === 'preset1') updateState('lineLengthContrast', v); }} compact />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <Slider label="位置 X" min={-500} max={500} step={10} value={state.linePreset1X}
                                  onChange={(v) => { updateState('linePreset1X', v); if (state.linePreset === 'preset1') updateState('lineX', v); }} unit="px" compact />
                                <Slider label="位置 Y" min={-400} max={400} step={10} value={state.linePreset1Y}
                                  onChange={(v) => { updateState('linePreset1Y', v); if (state.linePreset === 'preset1') updateState('lineY', v); }} unit="px" compact />
                              </div>
                            </div>

                            {/* 预设2 控制器 */}
                            <div
                              className={cx(
                                'rounded-2xl border p-3 space-y-3',
                                state.linePreset === 'preset2'
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-black">预设 2</div>
                                {state.linePreset === 'preset2' && (
                                  <div className="text-[11px] font-black text-[#9e76ff]">已选中</div>
                                )}
                              </div>
                              <div className="grid grid-cols-3 gap-3">
                                <Slider label="条数" min={2} max={5} step={1} value={state.linePreset2Count}
                                  onChange={(v) => { updateState('linePreset2Count', v); if (state.linePreset === 'preset2') updateState('lineCount', v); }} compact />
                                <Slider label="厚度" min={10} max={80} step={1} value={state.linePreset2Thickness}
                                  onChange={(v) => { updateState('linePreset2Thickness', v); if (state.linePreset === 'preset2') updateState('lineThickness', v); }} unit="px" compact />
                                <Slider label="长度对比" min={0} max={1} step={0.05} value={state.linePreset2LengthContrast}
                                  onChange={(v) => { updateState('linePreset2LengthContrast', v); if (state.linePreset === 'preset2') updateState('lineLengthContrast', v); }} compact />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <Slider label="位置 X" min={-500} max={500} step={10} value={state.linePreset2X}
                                  onChange={(v) => { updateState('linePreset2X', v); if (state.linePreset === 'preset2') updateState('lineX', v); }} unit="px" compact />
                                <Slider label="位置 Y" min={-400} max={400} step={10} value={state.linePreset2Y}
                                  onChange={(v) => { updateState('linePreset2Y', v); if (state.linePreset === 'preset2') updateState('lineY', v); }} unit="px" compact />
                              </div>
                            </div>

                            {/* 预设3 控制器 */}
                            <div
                              className={cx(
                                'rounded-2xl border p-3 space-y-3',
                                state.linePreset === 'preset3'
                                  ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                                  : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-black">预设 3</div>
                                {state.linePreset === 'preset3' && (
                                  <div className="text-[11px] font-black text-[#9e76ff]">已选中</div>
                                )}
                              </div>
                              <div className="grid grid-cols-3 gap-3">
                                <Slider label="条数" min={2} max={5} step={1} value={state.linePreset3Count}
                                  onChange={(v) => { updateState('linePreset3Count', v); if (state.linePreset === 'preset3') updateState('lineCount', v); }} compact />
                                <Slider label="厚度" min={10} max={80} step={1} value={state.linePreset3Thickness}
                                  onChange={(v) => { updateState('linePreset3Thickness', v); if (state.linePreset === 'preset3') updateState('lineThickness', v); }} unit="px" compact />
                                <Slider label="长度对比" min={0} max={1} step={0.05} value={state.linePreset3LengthContrast}
                                  onChange={(v) => { updateState('linePreset3LengthContrast', v); if (state.linePreset === 'preset3') updateState('lineLengthContrast', v); }} compact />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <Slider label="位置 X" min={-500} max={500} step={10} value={state.linePreset3X}
                                  onChange={(v) => { updateState('linePreset3X', v); if (state.linePreset === 'preset3') updateState('lineX', v); }} unit="px" compact />
                                <Slider label="位置 Y" min={-400} max={400} step={10} value={state.linePreset3Y}
                                  onChange={(v) => { updateState('linePreset3Y', v); if (state.linePreset === 'preset3') updateState('lineY', v); }} unit="px" compact />
                              </div>
                            </div>
                          </div>

                          <LineColorDots
                            label="颜色"
                            options={[
                              ...availableGraphicColors.slice(0, 4).map((c) => ({
                                id: c,
                                kind: 'solid' as const,
                                value: c,
                              })),
                              { id: 'sandwich', kind: 'special', value: 'sandwich' },
                              { id: 'sandwich2', kind: 'special', value: 'sandwich2' },
                            ]}
                            selected={
                              state.lineColors.length
                                ? state.lineColors
                                : [availableGraphicColors[0]]
                            }
                            onToggle={(id) => {
                              const curr = state.lineColors.length
                                ? state.lineColors
                                : [availableGraphicColors[0]];
                              const isOn = curr.includes(id);
                              const next = isOn
                                ? curr.filter((x) => x !== id)
                                : curr.length >= 3
                                  ? curr
                                  : [...curr, id];
                              if (!isOn && curr.length >= 3) {
                                setToast('线条颜色最多只能选择 3 种');
                                return;
                              }
                              updateState(
                                'lineColors',
                                next.length ? next : [availableGraphicColors[0]],
                              );
                            }}
                          />
                          <button
                            type="button"
                            onClick={randomizeLine}
                            className="w-full mt-1 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black shadow-sm hover:bg-[#7e49f4] transition"
                          >
                            随机生成
                          </button>
                        </div>
                      </PanelCard>
                    )}

                    {state.graphicType === 'plane' && (
                      <PanelCard title="面" icon={<Shuffle size={16} />}>
                        <div className="space-y-4">
                          <FieldLabel label="图形形状" />
                          <Segmented
                            value={state.planeShape}
                            onChange={(v) => updateState('planeShape', v)}
                            options={[
                              { value: 'square', label: '方形' },
                              { value: 'circle', label: '圆形' },
                              { value: 'triangle', label: '多边形' },
                              { value: 'random', label: '随机形状' },
                            ]}
                          />

                          {/* 每种形状的预设按钮 */}
                          <div className="flex gap-2">
                            {(['preset1', 'preset2', 'preset3'] as const).map((p) => {
                              const activePreset =
                                state.planeShape === 'square' ? state.squarePlanePreset
                                : state.planeShape === 'circle' ? state.circlePlanePreset
                                : state.planeShape === 'triangle' ? state.trianglePlanePreset
                                : state.randomPlanePreset;
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => applyPlanePreset(p)}
                                  className={cx(
                                    'flex-1 py-2 rounded-xl text-[12px] font-black transition border',
                                    activePreset === p
                                      ? 'bg-[#9e76ff] text-white border-[#9e76ff]'
                                      : 'bg-white text-[#9e76ff] border-[#9e76ff]/40 hover:border-[#9e76ff]',
                                  )}
                                >
                                  预设 {p.replace('preset', '')}
                                </button>
                              );
                            })}
                          </div>

                          {false && (<div>
                          <FieldLabel label="叠放顺序" />
                          <Segmented
                            value={state.planeOrder}
                            onChange={(v) => updateState('planeOrder', v)}
                            options={[
                              { value: '1-over-2', label: '1 在上' },
                              { value: '2-over-1', label: '2 在上' },
                            ]}
                          />

                          <div className="h-px bg-slate-100" />
                          <div className="space-y-3">
                            <FieldLabel
                              label={`图形1（${
                                state.planeShape === 'random'
                                  ? planeShapes.s1 === 'square'
                                    ? '方形'
                                    : planeShapes.s1 === 'circle'
                                      ? '圆形'
                                      : '多边形'
                                  : state.planeShape === 'square'
                                    ? '方形'
                                    : state.planeShape === 'circle'
                                      ? '圆形'
                                      : '多边形'
                              }）`}
                            />
                            <ColorPickDots
                              label="颜色"
                              colors={availableGraphicColors}
                              value={
                                availableGraphicColors.includes(state.plane1.color)
                                  ? state.plane1.color
                                  : availableGraphicColors[0]
                              }
                              onPick={(c) => setPlaneColor('plane1', c)}
                            />
                            {(state.planeShape === 'random'
                              ? planeShapes.s1
                              : state.planeShape) === 'square' && (
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="宽度"
                                  min={200}
                                  max={1800}
                                  step={10}
                                  value={state.plane1.width}
                                  onChange={(v) => updatePlane('plane1', { width: v })}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="高度"
                                  min={200}
                                  max={1600}
                                  step={10}
                                  value={state.plane1.height}
                                  onChange={(v) => updatePlane('plane1', { height: v })}
                                  unit="px"
                                  compact
                                />
                              </div>
                            )}
                            {(state.planeShape === 'random'
                              ? planeShapes.s1
                              : state.planeShape) === 'circle' && (
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="横向半径"
                                  min={80}
                                  max={900}
                                  step={5}
                                  value={Math.round(state.plane1.width / 2)}
                                  onChange={(v) =>
                                    updatePlane('plane1', { width: v * 2 })
                                  }
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="纵向半径"
                                  min={80}
                                  max={650}
                                  step={5}
                                  value={Math.round(state.plane1.height / 2)}
                                  onChange={(v) =>
                                    updatePlane('plane1', { height: v * 2 })
                                  }
                                  unit="px"
                                  compact
                                />
                              </div>
                            )}
                            {(state.planeShape === 'random'
                              ? planeShapes.s1
                              : state.planeShape) === 'triangle' && (
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="变数"
                                  min={3}
                                  max={10}
                                  step={1}
                                  value={state.plane1.sides}
                                  onChange={(v) => updatePlane('plane1', { sides: v })}
                                  compact
                                />
                                <Slider
                                  label="半径"
                                  min={80}
                                  max={900}
                                  step={5}
                                  value={state.plane1.radius}
                                  onChange={(v) =>
                                    updatePlane('plane1', { radius: v })
                                  }
                                  unit="px"
                                  compact
                                />
                              </div>
                            )}
                            <div className="grid grid-cols-3 gap-3">
                              <Slider
                                label="角度"
                                min={-180}
                                max={180}
                                step={1}
                                value={state.plane1.angle}
                                onChange={(v) => updatePlane('plane1', { angle: v })}
                                unit="°"
                                compact
                              />
                              <Slider
                                label="X"
                                min={0}
                                max={100}
                                step={1}
                                value={state.plane1.x}
                                onChange={(v) => updatePlane('plane1', { x: v })}
                                unit="%"
                                compact
                              />
                              <Slider
                                label="Y"
                                min={0}
                                max={100}
                                step={1}
                                value={state.plane1.y}
                                onChange={(v) => updatePlane('plane1', { y: v })}
                                unit="%"
                                compact
                              />
                            </div>
                          </div>

                          <div className="h-px bg-slate-100" />
                          <div className="space-y-3">
                            <FieldLabel
                              label={`图形2（${
                                state.planeShape === 'random'
                                  ? planeShapes.s2 === 'square'
                                    ? '方形'
                                    : planeShapes.s2 === 'circle'
                                      ? '圆形'
                                      : '多边形'
                                  : state.planeShape === 'square'
                                    ? '方形'
                                    : state.planeShape === 'circle'
                                      ? '圆形'
                                      : '多边形'
                              }）`}
                            />
                            <ColorPickDots
                              label="颜色"
                              colors={availableGraphicColors}
                              value={
                                availableGraphicColors.includes(state.plane2.color)
                                  ? state.plane2.color
                                  : availableGraphicColors[1] || availableGraphicColors[0]
                              }
                              onPick={(c) => setPlaneColor('plane2', c)}
                            />
                            {(state.planeShape === 'random'
                              ? planeShapes.s2
                              : state.planeShape) === 'square' && (
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="宽度"
                                  min={200}
                                  max={1800}
                                  step={10}
                                  value={state.plane2.width}
                                  onChange={(v) => updatePlane('plane2', { width: v })}
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="高度"
                                  min={200}
                                  max={1600}
                                  step={10}
                                  value={state.plane2.height}
                                  onChange={(v) => updatePlane('plane2', { height: v })}
                                  unit="px"
                                  compact
                                />
                              </div>
                            )}
                            {(state.planeShape === 'random'
                              ? planeShapes.s2
                              : state.planeShape) === 'circle' && (
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="横向半径"
                                  min={80}
                                  max={900}
                                  step={5}
                                  value={Math.round(state.plane2.width / 2)}
                                  onChange={(v) =>
                                    updatePlane('plane2', { width: v * 2 })
                                  }
                                  unit="px"
                                  compact
                                />
                                <Slider
                                  label="纵向半径"
                                  min={80}
                                  max={650}
                                  step={5}
                                  value={Math.round(state.plane2.height / 2)}
                                  onChange={(v) =>
                                    updatePlane('plane2', { height: v * 2 })
                                  }
                                  unit="px"
                                  compact
                                />
                              </div>
                            )}
                            {(state.planeShape === 'random'
                              ? planeShapes.s2
                              : state.planeShape) === 'triangle' && (
                              <div className="grid grid-cols-2 gap-3">
                                <Slider
                                  label="变数"
                                  min={3}
                                  max={10}
                                  step={1}
                                  value={state.plane2.sides}
                                  onChange={(v) => updatePlane('plane2', { sides: v })}
                                  compact
                                />
                                <Slider
                                  label="半径"
                                  min={80}
                                  max={900}
                                  step={5}
                                  value={state.plane2.radius}
                                  onChange={(v) =>
                                    updatePlane('plane2', { radius: v })
                                  }
                                  unit="px"
                                  compact
                                />
                              </div>
                            )}
                            <div className="grid grid-cols-3 gap-3">
                              <Slider
                                label="角度"
                                min={-180}
                                max={180}
                                step={1}
                                value={state.plane2.angle}
                                onChange={(v) => updatePlane('plane2', { angle: v })}
                                unit="°"
                                compact
                              />
                              <Slider
                                label="X"
                                min={0}
                                max={100}
                                step={1}
                                value={state.plane2.x}
                                onChange={(v) => updatePlane('plane2', { x: v })}
                                unit="%"
                                compact
                              />
                              <Slider
                                label="Y"
                                min={0}
                                max={100}
                                step={1}
                                value={state.plane2.y}
                                onChange={(v) => updatePlane('plane2', { y: v })}
                                unit="%"
                                compact
                              />
                            </div>
                          </div>


                          </div>)}                          <button
                            type="button"
                            onClick={randomizePlanes}
                            className="w-full mt-1 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black shadow-sm hover:bg-[#7e49f4] transition"
                          >
                            随机生成
                          </button>
                        </div>
                      </PanelCard>
                    )}

                    {state.graphicType === 'svg' && (
                      <PanelCard
                        title="手动上传"
                        icon={<ImageIcon size={16} />}
                        right={
                          <span className="text-[11px] font-black text-slate-500">
                            {state.uploadedSvgs.length}/4
                          </span>
                        }
                      >
                        <div className="space-y-3">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/svg+xml"
                            className="hidden"
                            onChange={handleFileUpload}
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black hover:bg-[#7e49f4] transition"
                          >
                            <ImageIcon size={18} />
                            上传 SVG
                          </button>
                          {state.uploadedSvgs.length > 0 && (
                            <div className="space-y-2">
                              {state.uploadedSvgs.map((s, idx) => (
                                <div
                                  key={s.id}
                                  className="px-3 py-3 rounded-2xl border border-slate-200 bg-white space-y-3"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[12px] font-black text-slate-800">
                                      图形 {idx + 1}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateState(
                                          'uploadedSvgs',
                                          state.uploadedSvgs.filter(
                                            (x) => x.id !== s.id,
                                          ),
                                        )
                                      }
                                      className="w-10 h-10 rounded-2xl border border-slate-200 hover:bg-slate-50 flex items-center justify-center"
                                      aria-label={`删除图形 ${idx + 1}`}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>

                                  <Slider
                                    label="大小"
                                    min={0.2}
                                    max={3}
                                    step={0.05}
                                    value={s.scale}
                                    onChange={(v) => updateSvg(s.id, { scale: v })}
                                    compact
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Toggle
                                      checked={s.flipH}
                                      onChange={(v) => updateSvg(s.id, { flipH: v })}
                                      label="水平翻转"
                                    />
                                    <Toggle
                                      checked={s.flipV}
                                      onChange={(v) => updateSvg(s.id, { flipV: v })}
                                      label="垂直翻转"
                                    />
                                  </div>
                                </div>
                              ))}
                              <div className="text-[12px] text-slate-500">
                                提示：拖拽 SVG 可在画布上移动位置。
                              </div>
                            </div>
                          )}
                        </div>
                      </PanelCard>
                    )}

                    <PanelCard title="快捷操作" icon={<Settings2 size={16} />}>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={quickRandomize}
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white border border-slate-200 text-[13px] font-black"
                        >
                          <Shuffle size={18} />
                          随机一版
                        </button>
                        <button
                          type="button"
                          onClick={resetAll}
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white border border-slate-200 text-[13px] font-black"
                        >
                          <RotateCcw size={18} />
                          重置
                        </button>
                      </div>
                    </PanelCard>
                  </motion.div>
                )}

                {activeTab === 'output' && (
                  <motion.div
                    key="output"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                    <PanelCard title="输出规格" icon={<Settings2 size={16} />}>
                      <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-3">
                        <div>
                          <div className="text-[12px] font-black text-slate-800">
                            1920 × 900 PX
                          </div>
                          <div className="text-[12px] text-slate-500 mt-0.5">
                            比例 2.1:1
                          </div>
                        </div>
                        <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-700">
                          <Download size={18} />
                        </div>
                      </div>
                    </PanelCard>

                    <PanelCard title="选择导出格式" icon={<Download size={16} />}>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => exportImage('png')}
                          disabled={isExporting}
                          className="rounded-3xl border border-slate-200 bg-white p-5 flex flex-col items-center gap-2 text-slate-900 disabled:opacity-60"
                        >
                          <ImageIcon size={28} />
                          <div className="text-[14px] font-black">导出 PNG</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => exportImage('jpeg')}
                          disabled={isExporting}
                          className="rounded-3xl border border-slate-200 bg-white p-5 flex flex-col items-center gap-2 text-slate-900 disabled:opacity-60"
                        >
                          <ImageIcon size={28} />
                          <div className="text-[14px] font-black">导出 JPG</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => exportSvg()}
                          disabled={isExporting}
                          className="col-span-2 rounded-3xl border border-slate-200 bg-white p-5 flex items-center justify-center gap-3 text-slate-900 disabled:opacity-60"
                        >
                          <FileCode size={26} />
                          <div className="text-[14px] font-black">导出矢量 SVG</div>
                        </button>
                      </div>
                    </PanelCard>

                    <PanelCard title="提示" icon={<Info size={16} />}>
                      <div className="text-[12px] text-slate-600 leading-relaxed">
                        导出图片将包含所有图层信息。SVG 导出为矢量格式，适合后期二次编辑。
                      </div>
                    </PanelCard>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </aside>
        )}
      </div>

      {/* desktop layout */}
      <div className="hidden md:flex h-full">
        <aside
          className="bg-white border-r border-slate-200 flex flex-col overflow-hidden relative"
          style={{ width: sidebarCollapsed ? 80 : sidebarWidth }}
        >
          {/* resize handle */}
          {!sidebarCollapsed && (
            <div
              className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-50"
              onMouseDown={startResizeSidebar}
            >
              <div className="absolute top-0 right-0 w-px h-full bg-slate-200" />
            </div>
          )}

          {/* collapse/expand button */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="absolute top-3 right-3 z-50 w-9 h-9 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center"
            aria-label={sidebarCollapsed ? 'expand sidebar' : 'collapse sidebar'}
            title={sidebarCollapsed ? '展开面板' : '收起面板'}
          >
            {sidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>

          {sidebarCollapsed ? (
            <div className="h-full flex flex-col items-center pt-16 gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('typography')}
                className={cx(
                  'w-12 h-12 rounded-2xl border flex items-center justify-center',
                  activeTab === 'typography'
                    ? 'border-[#9e76ff]/30 bg-[#9e76ff]/10 text-[#9e76ff]'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
                title="文字排版"
              >
                <Type size={20} />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('graphic')}
                className={cx(
                  'w-12 h-12 rounded-2xl border flex items-center justify-center',
                  activeTab === 'graphic'
                    ? 'border-[#9e76ff]/30 bg-[#9e76ff]/10 text-[#9e76ff]'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
                title="图形设计"
              >
                <Palette size={20} />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('output')}
                className={cx(
                  'w-12 h-12 rounded-2xl border flex items-center justify-center',
                  activeTab === 'output'
                    ? 'border-[#9e76ff]/30 bg-[#9e76ff]/10 text-[#9e76ff]'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
                title="输出文件"
              >
                <Download size={20} />
              </button>
            </div>
          ) : (
            <>
              <AppShellHeader
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onPreview={() => setMobileView('preview')}
              />

              <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-hide">
              <AnimatePresence mode="wait">
            {activeTab === 'typography' && (
              <motion.div
                key="typography"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4"
              >
                <PanelCard title="版式规范（全局参考）" icon={<Info size={16} />}>
                  <div className="space-y-3">
                    <Toggle
                      checked={state.showGuides}
                      onChange={(v) => updateState('showGuides', v)}
                      label="显示参考线"
                    />
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                      <div className="text-[12px] font-black text-slate-800">
                        排版注意事项
                      </div>
                      <div className="mt-2 space-y-1 text-[12px] text-slate-600 leading-relaxed">
                        <div>1. 中英文字体统一使用兰亭黑。</div>
                        <div>2. 主标题文字整体范围控制在区域A中，且整体行数建议为3行。</div>
                        <div>3. 画布尺寸为1920*900 像素。</div>
                      </div>
                    </div>
                  </div>
                </PanelCard>

                <div>
                  <PanelCard
                    title="主标题"
                    icon={<Type size={16} />}
                  >
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel label="文本内容" hint="支持换行" />
                        <textarea
                          value={state.mainMixedText}
                          onChange={(e) => setMainMixedText(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-[13px] font-bold min-h-[96px] focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                        />
                      </div>
                      <Slider
                        label="字号"
                        min={MAIN_EN_SIZE_MIN}
                        max={MAIN_EN_SIZE_MAX}
                        step={5}
                        value={state.mainEnSize}
                        onChange={setMainEnSizeSynced}
                        unit="px"
                      />
                      {/* 主标题粗细固定为粗黑(700)，界面不再提供调整入口 */}
                      {/* 行距固定：不在界面显示 */}
                    </div>
                  </PanelCard>

                  {false && (
                  <PanelCard
                    title="主标题（中文）"
                    icon={<Type size={16} />}
                    right={
                      <div className="flex items-center gap-2">
                        <IconToggle
                          on={state.showMainZh}
                          onClick={() => updateState('showMainZh', !state.showMainZh)}
                          iconOn={<Eye size={16} />}
                          iconOff={<EyeOff size={16} />}
                          label="显示/隐藏（中文）"
                        />
                        <IconToggle
                          on={state.isSizeLinked}
                          onClick={() => updateState('isSizeLinked', !state.isSizeLinked)}
                          iconOn={<Lock size={16} />}
                          iconOff={<Unlock size={16} />}
                          label="联动锁（中英字号）"
                          disabled={!(state.showMainEn && state.showMainZh)}
                        />
                      </div>
                    }
                  >
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel label="文本内容" />
                        <textarea
                          value={state.mainZhText}
                          onChange={(e) =>
                            updateState('mainZhText', e.target.value)
                          }
                          className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-[13px] font-bold min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                        />
                      </div>
                      <Slider
                        label="字号"
                        hint={
                          state.showMainEn && state.showMainZh
                            ? state.isSizeLinked
                              ? '联动开启：可调中/英任意一个，自动同步'
                              : '联动关闭：可分别调整中/英字号'
                            : undefined
                        }
                        min={MAIN_ZH_SIZE_MIN}
                        max={MAIN_ZH_SIZE_MAX}
                        step={5}
                        value={state.mainZhSize}
                        disabled={state.showMainEn && state.showMainZh && state.isSizeLinked}
                        onChange={setMainZhSizeSynced}
                        unit="px"
                      />
                      <Segmented
                        value={
                          (state.mainZhWeight >= 700
                            ? '700'
                            : state.mainZhWeight >= 600
                            ? '600'
                            : '500') as '500' | '600' | '700'
                        }
                        onChange={(v) =>
                          updateState('mainZhWeight', Number(v))
                        }
                        options={[
                          { value: '500', label: '中黑' },
                          { value: '600', label: '粗黑' },
                          { value: '700', label: '粗黑+' },
                        ]}
                      />
                      {/* 行距固定：不在界面显示 */}
                    </div>
                  </PanelCard>
                  )}

                  <PanelCard title="副标题（区域 B）" icon={<Check size={16} />}>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel label="副标题1" hint="时间" />
                        <input
                          value={state.sub1Text}
                          onChange={(e) =>
                            updateState('sub1Text', e.target.value)
                          }
                          className="w-full bg-white border border-slate-200 rounded-2xl px-3 py-2.5 text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                        />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel label="副标题2" hint="最多两行" />
                        <textarea
                          value={state.sub2Text}
                          onChange={(e) =>
                            updateState('sub2Text', keepMaxLines(e.target.value, 2))
                          }
                          className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-[13px] font-bold min-h-[88px] focus:outline-none focus:ring-2 focus:ring-[#9e76ff]/30"
                        />
                      </div>
                    </div>
                  </PanelCard>
                </div>
              </motion.div>
            )}
            {activeTab === 'graphic' && (
              <motion.div
                key="graphic"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                <PanelCard title="背景与图形" icon={<Palette size={16} />}>
                  <div className="space-y-3">
                    <FieldLabel label="背景颜色选择" />
                    <div className="grid grid-cols-2 gap-2">
                      {(['#ffffff', '#dfd9ff'] as const).map((c) => (
                        <button
                          key={c}
                          onClick={() => updateState('bgColor', c)}
                          className={cx(
                            'rounded-2xl border px-3 py-2.5 text-[12px] font-black transition flex items-center justify-center gap-2',
                            state.bgColor === c
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'bg-white border-slate-200',
                          )}
                        >
                          <span
                            className="w-4 h-4 rounded-md border border-slate-200"
                            style={{ backgroundColor: c }}
                          />
                          {c === '#ffffff' ? '纯白' : '浅紫'}
                        </button>
                      ))}
                    </div>

                    <FieldLabel label="图形元素方向（单选）" />
                    <Segmented
                      value={state.graphicType}
                      onChange={(v) => updateState('graphicType', v)}
                      options={[
                        { value: 'dot', label: '点' },
                        { value: 'line', label: '线' },
                        { value: 'plane', label: '面' },
                        { value: 'svg', label: '手动上传' },
                      ]}
                    />
                  </div>
                </PanelCard>

                {state.graphicType === 'dot' && (
                  <PanelCard
                    title="点阵"
                    icon={<Shuffle size={16} />}
                  >
                    <div className="space-y-4">
                      <FieldLabel label="图形形状" />
                      <Segmented
                        value={state.dotShape}
                        onChange={(v) => updateState('dotShape', v)}
                        options={[
                          { value: 'circle', label: '圆形' },
                          { value: 'triangle', label: '三角形' },
                          { value: 'square', label: '正方形' },
                          { value: 'random', label: '图形随机' },
                        ]}
                      />

                      <ColorDots
                        label="颜色色盘选择"
                        colors={availableGraphicColors}
                        selected={state.dotColors.length ? state.dotColors : [availableGraphicColors[0]]}
                        onToggle={(c) => {
                          const curr = state.dotColors.length
                            ? state.dotColors
                            : [availableGraphicColors[0]];
                          const next = curr.includes(c)
                            ? curr.filter((x) => x !== c)
                            : [...curr, c];
                          updateState('dotColors', next.length ? next : [c]);
                        }}
                      />

                      <FieldLabel label="布局预设" />
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            'preset1',
                            'preset2',
                            'preset3',
                          ] as const
                        ).map((p, i) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => applyDotPreset(p)}
                            className={cx(
                              'rounded-2xl border py-2.5 text-[12px] font-black transition',
                              state.dotPreset === p
                                ? 'border-[#9e76ff] bg-[#9e76ff]/10 text-[#9e76ff]'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#9e76ff]/40',
                            )}
                          >
                            {p === 'preset1'
                              ? '预设 1'
                              : p === 'preset2'
                                ? '预设 2'
                                : '预设 3'}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-3 pt-2 hidden">
                        <div
                          className={cx(
                            'rounded-2xl border p-3 space-y-3',
                            state.dotPreset === 'preset1'
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black">预设 1</div>
                            {state.dotPreset === 'preset1' && (
                              <div className="text-[11px] font-black text-[#9e76ff]">
                                已选中
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <Slider
                              label="数量"
                              min={5}
                              max={80}
                              step={1}
                              value={state.dotPreset1Count}
                              onChange={(v) => {
                                updateState('dotPreset1Count', v);
                                if (state.dotPreset === 'preset1') {
                                  updateState('dotCount', v);
                                }
                              }}
                            />
                            <Slider
                              label="分散"
                              min={0}
                              max={200}
                              step={1}
                              value={state.dotPreset1Spread}
                              onChange={(v) => {
                                updateState('dotPreset1Spread', v);
                                if (state.dotPreset === 'preset1') {
                                  updateState('dotSpread', v);
                                }
                              }}
                            />
                          </div>

                          <Slider
                            label="左右分散"
                            min={0}
                            max={400}
                            step={1}
                            value={state.dotPreset1SideSpread}
                            onChange={(v) => {
                              updateState('dotPreset1SideSpread', v);
                              if (state.dotPreset === 'preset1') {
                                updateState('dotSideSpread', v);
                              }
                            }}
                            unit="%"
                          />

                          <div className="grid grid-cols-1 gap-3">
                            <Slider
                              label="偏移 X"
                              min={-400}
                              max={400}
                              step={5}
                              value={state.dotPreset1X}
                              onChange={(v) => {
                                updateState('dotPreset1X', v);
                                if (state.dotPreset === 'preset1') {
                                  updateState('dotX', v);
                                }
                              }}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="偏移 Y"
                              min={-250}
                              max={250}
                              step={5}
                              value={state.dotPreset1Y}
                              onChange={(v) => {
                                updateState('dotPreset1Y', v);
                                if (state.dotPreset === 'preset1') {
                                  updateState('dotY', v);
                                }
                              }}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="旋转"
                              min={0}
                              max={360}
                              step={1}
                              value={state.dotPreset1Rotation}
                              onChange={(v) => {
                                updateState('dotPreset1Rotation', v);
                                if (state.dotPreset === 'preset1') {
                                  updateState('dotRotation', v);
                                }
                              }}
                              unit="°"
                              compact
                            />
                          </div>
                        </div>

                        <div
                          className={cx(
                            'rounded-2xl border p-3 space-y-3',
                            state.dotPreset === 'preset2'
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black">预设 2</div>
                            {state.dotPreset === 'preset2' && (
                              <div className="text-[11px] font-black text-[#9e76ff]">
                                已选中
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <Slider
                              label="数量"
                              min={5}
                              max={80}
                              step={1}
                              value={state.dotPreset2Count}
                              onChange={(v) => {
                                updateState('dotPreset2Count', v);
                                if (state.dotPreset === 'preset2') {
                                  updateState('dotCount', v);
                                }
                              }}
                            />
                            <Slider
                              label="分散"
                              min={0}
                              max={200}
                              step={1}
                              value={state.dotPreset2Spread}
                              onChange={(v) => {
                                updateState('dotPreset2Spread', v);
                                if (state.dotPreset === 'preset2') {
                                  updateState('dotSpread', v);
                                }
                              }}
                            />
                          </div>

                          <Slider
                            label="左右分散"
                            min={0}
                            max={400}
                            step={1}
                            value={state.dotPreset2SideSpread}
                            onChange={(v) => {
                              updateState('dotPreset2SideSpread', v);
                              if (state.dotPreset === 'preset2') {
                                updateState('dotSideSpread', v);
                              }
                            }}
                            unit="%"
                          />

                          <div className="grid grid-cols-1 gap-3">
                            <Slider
                              label="偏移 X"
                              min={-400}
                              max={400}
                              step={5}
                              value={state.dotPreset2X}
                              onChange={(v) => {
                                updateState('dotPreset2X', v);
                                if (state.dotPreset === 'preset2') {
                                  updateState('dotX', v);
                                }
                              }}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="偏移 Y"
                              min={-250}
                              max={250}
                              step={5}
                              value={state.dotPreset2Y}
                              onChange={(v) => {
                                updateState('dotPreset2Y', v);
                                if (state.dotPreset === 'preset2') {
                                  updateState('dotY', v);
                                }
                              }}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="旋转"
                              min={0}
                              max={360}
                              step={1}
                              value={state.dotPreset2Rotation}
                              onChange={(v) => {
                                updateState('dotPreset2Rotation', v);
                                if (state.dotPreset === 'preset2') {
                                  updateState('dotRotation', v);
                                }
                              }}
                              unit="°"
                              compact
                            />
                          </div>
                        </div>

                        <div
                          className={cx(
                            'rounded-2xl border p-3 space-y-3',
                            state.dotPreset === 'preset3'
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black">预设 3</div>
                            {state.dotPreset === 'preset3' && (
                              <div className="text-[11px] font-black text-[#9e76ff]">
                                已选中
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <Slider
                              label="数量"
                              min={5}
                              max={80}
                              step={1}
                              value={state.dotPreset3Count}
                              onChange={(v) => {
                                updateState('dotPreset3Count', v);
                                if (state.dotPreset === 'preset3') {
                                  updateState('dotCount', v);
                                }
                              }}
                            />
                            <Slider
                              label="分散"
                              min={0}
                              max={200}
                              step={1}
                              value={state.dotPreset3Spread}
                              onChange={(v) => {
                                updateState('dotPreset3Spread', v);
                                if (state.dotPreset === 'preset3') {
                                  updateState('dotSpread', v);
                                }
                              }}
                            />
                          </div>

                          <Slider
                            label="左右分散"
                            min={0}
                            max={400}
                            step={1}
                            value={state.dotPreset3SideSpread}
                            onChange={(v) => {
                              updateState('dotPreset3SideSpread', v);
                              if (state.dotPreset === 'preset3') {
                                updateState('dotSideSpread', v);
                              }
                            }}
                            unit="%"
                          />

                          <div className="grid grid-cols-1 gap-3">
                            <Slider
                              label="偏移 X"
                              min={-400}
                              max={400}
                              step={5}
                              value={state.dotPreset3X}
                              onChange={(v) => {
                                updateState('dotPreset3X', v);
                                if (state.dotPreset === 'preset3') {
                                  updateState('dotX', v);
                                }
                              }}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="偏移 Y"
                              min={-250}
                              max={250}
                              step={5}
                              value={state.dotPreset3Y}
                              onChange={(v) => {
                                updateState('dotPreset3Y', v);
                                if (state.dotPreset === 'preset3') {
                                  updateState('dotY', v);
                                }
                              }}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="旋转"
                              min={0}
                              max={360}
                              step={1}
                              value={state.dotPreset3Rotation}
                              onChange={(v) => {
                                updateState('dotPreset3Rotation', v);
                                if (state.dotPreset === 'preset3') {
                                  updateState('dotRotation', v);
                                }
                              }}
                              unit="°"
                              compact
                            />
                          </div>
                        </div>
                      </div>

                      <div
                        className={cx(
                          'rounded-2xl border p-3 space-y-3 hidden',
                          state.dotPreset === 'preset4'
                            ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                            : 'border-slate-200 bg-white',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-[12px] font-black">预设 4</div>
                          {state.dotPreset === 'preset4' && (
                            <div className="text-[11px] font-black text-[#9e76ff]">
                              已选中
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          <Slider
                            label="数量"
                            min={5}
                            max={80}
                            step={1}
                            value={state.dotPreset4Count}
                            onChange={(v) => {
                              updateState('dotPreset4Count', v);
                              if (state.dotPreset === 'preset4') {
                                updateState('dotCount', v);
                              }
                            }}
                          />
                          <Slider
                            label="分散"
                            min={0}
                            max={200}
                            step={1}
                            value={state.dotPreset4Spread}
                            onChange={(v) => {
                              updateState('dotPreset4Spread', v);
                              if (state.dotPreset === 'preset4') {
                                updateState('dotSpread', v);
                              }
                            }}
                          />
                        </div>

                        <Slider
                          label="左右分散"
                          min={0}
                          max={400}
                          step={1}
                          value={state.dotPreset4SideSpread}
                          onChange={(v) => {
                            updateState('dotPreset4SideSpread', v);
                            if (state.dotPreset === 'preset4') {
                              updateState('dotSideSpread', v);
                            }
                          }}
                          unit="%"
                        />

                        <div className="grid grid-cols-1 gap-3">
                          <Slider
                            label="偏移 X"
                            min={-400}
                            max={400}
                            step={5}
                            value={state.dotPreset4X}
                            onChange={(v) => {
                              updateState('dotPreset4X', v);
                              if (state.dotPreset === 'preset4') {
                                updateState('dotX', v);
                              }
                            }}
                            unit="px"
                            compact
                          />
                          <Slider
                            label="偏移 Y"
                            min={-250}
                            max={250}
                            step={5}
                            value={state.dotPreset4Y}
                            onChange={(v) => {
                              updateState('dotPreset4Y', v);
                              if (state.dotPreset === 'preset4') {
                                updateState('dotY', v);
                              }
                            }}
                            unit="px"
                            compact
                          />
                          <Slider
                            label="旋转"
                            min={0}
                            max={360}
                            step={1}
                            value={state.dotPreset4Rotation}
                            onChange={(v) => {
                              updateState('dotPreset4Rotation', v);
                              if (state.dotPreset === 'preset4') {
                                updateState('dotRotation', v);
                              }
                            }}
                            unit="°"
                            compact
                          />
                        </div>
                      </div>

                      <div
                        className={cx(
                          'rounded-2xl border p-3 space-y-3 hidden',
                          state.dotPreset === 'preset5'
                            ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                            : 'border-slate-200 bg-white',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-[12px] font-black">预设 5</div>
                          {state.dotPreset === 'preset5' && (
                            <div className="text-[11px] font-black text-[#9e76ff]">
                              已选中
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          <Slider
                            label="数量"
                            min={5}
                            max={80}
                            step={1}
                            value={state.dotPreset5Count}
                            onChange={(v) => {
                              updateState('dotPreset5Count', v);
                              if (state.dotPreset === 'preset5') {
                                updateState('dotCount', v);
                              }
                            }}
                          />
                          <Slider
                            label="分散"
                            min={0}
                            max={200}
                            step={1}
                            value={state.dotPreset5Spread}
                            onChange={(v) => {
                              updateState('dotPreset5Spread', v);
                              if (state.dotPreset === 'preset5') {
                                updateState('dotSpread', v);
                              }
                            }}
                          />
                        </div>

                        <Slider
                          label="左右分散"
                          min={0}
                          max={400}
                          step={1}
                          value={state.dotPreset5SideSpread}
                          onChange={(v) => {
                            updateState('dotPreset5SideSpread', v);
                            if (state.dotPreset === 'preset5') {
                              updateState('dotSideSpread', v);
                            }
                          }}
                          unit="%"
                        />

                        <div className="grid grid-cols-1 gap-3">
                          <Slider
                            label="偏移 X"
                            min={-400}
                            max={400}
                            step={5}
                            value={state.dotPreset5X}
                            onChange={(v) => {
                              updateState('dotPreset5X', v);
                              if (state.dotPreset === 'preset5') {
                                updateState('dotX', v);
                              }
                            }}
                            unit="px"
                            compact
                          />
                          <Slider
                            label="偏移 Y"
                            min={-250}
                            max={250}
                            step={5}
                            value={state.dotPreset5Y}
                            onChange={(v) => {
                              updateState('dotPreset5Y', v);
                              if (state.dotPreset === 'preset5') {
                                updateState('dotY', v);
                              }
                            }}
                            unit="px"
                            compact
                          />
                          <Slider
                            label="旋转"
                            min={0}
                            max={360}
                            step={1}
                            value={state.dotPreset5Rotation}
                            onChange={(v) => {
                              updateState('dotPreset5Rotation', v);
                              if (state.dotPreset === 'preset5') {
                                updateState('dotRotation', v);
                              }
                            }}
                            unit="°"
                            compact
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={randomizeDot}
                        className="w-full mt-1 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black shadow-sm hover:bg-[#7e49f4] transition"
                      >
                        随机生成
                      </button>
                    </div>
                  </PanelCard>
                )}

                {state.graphicType === 'line' && (
                  <PanelCard
                    title="线条参数"
                    icon={<Shuffle size={16} />}
                  >
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        {(['preset1', 'preset2', 'preset3'] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => applyLinePreset(p)}
                            className={cx(
                              'flex-1 py-2 rounded-xl text-[12px] font-black transition border',
                              state.linePreset === p
                                ? 'bg-[#9e76ff] text-white border-[#9e76ff]'
                                : 'bg-white text-[#9e76ff] border-[#9e76ff]/40 hover:border-[#9e76ff]',
                            )}
                          >
                            预设 {p.replace('preset', '')}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-3 hidden">
                        {/* 预设1 控制器 */}
                        <div
                          className={cx(
                            'rounded-2xl border p-3 space-y-3',
                            state.linePreset === 'preset1'
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black">预设 1</div>
                            {state.linePreset === 'preset1' && (
                              <div className="text-[11px] font-black text-[#9e76ff]">已选中</div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <Slider label="条数" min={2} max={5} step={1} value={state.linePreset1Count}
                              onChange={(v) => { updateState('linePreset1Count', v); if (state.linePreset === 'preset1') updateState('lineCount', v); }} compact />
                            <Slider label="厚度" min={10} max={80} step={1} value={state.linePreset1Thickness}
                              onChange={(v) => { updateState('linePreset1Thickness', v); if (state.linePreset === 'preset1') updateState('lineThickness', v); }} unit="px" compact />
                            <Slider label="长度对比" min={0} max={1} step={0.05} value={state.linePreset1LengthContrast}
                              onChange={(v) => { updateState('linePreset1LengthContrast', v); if (state.linePreset === 'preset1') updateState('lineLengthContrast', v); }} compact />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Slider label="位置 X" min={-500} max={500} step={10} value={state.linePreset1X}
                              onChange={(v) => { updateState('linePreset1X', v); if (state.linePreset === 'preset1') updateState('lineX', v); }} unit="px" compact />
                            <Slider label="位置 Y" min={-400} max={400} step={10} value={state.linePreset1Y}
                              onChange={(v) => { updateState('linePreset1Y', v); if (state.linePreset === 'preset1') updateState('lineY', v); }} unit="px" compact />
                          </div>
                        </div>

                        {/* 预设2 控制器 */}
                        <div
                          className={cx(
                            'rounded-2xl border p-3 space-y-3',
                            state.linePreset === 'preset2'
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black">预设 2</div>
                            {state.linePreset === 'preset2' && (
                              <div className="text-[11px] font-black text-[#9e76ff]">已选中</div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <Slider label="条数" min={2} max={5} step={1} value={state.linePreset2Count}
                              onChange={(v) => { updateState('linePreset2Count', v); if (state.linePreset === 'preset2') updateState('lineCount', v); }} compact />
                            <Slider label="厚度" min={10} max={80} step={1} value={state.linePreset2Thickness}
                              onChange={(v) => { updateState('linePreset2Thickness', v); if (state.linePreset === 'preset2') updateState('lineThickness', v); }} unit="px" compact />
                            <Slider label="长度对比" min={0} max={1} step={0.05} value={state.linePreset2LengthContrast}
                              onChange={(v) => { updateState('linePreset2LengthContrast', v); if (state.linePreset === 'preset2') updateState('lineLengthContrast', v); }} compact />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Slider label="位置 X" min={-500} max={500} step={10} value={state.linePreset2X}
                              onChange={(v) => { updateState('linePreset2X', v); if (state.linePreset === 'preset2') updateState('lineX', v); }} unit="px" compact />
                            <Slider label="位置 Y" min={-400} max={400} step={10} value={state.linePreset2Y}
                              onChange={(v) => { updateState('linePreset2Y', v); if (state.linePreset === 'preset2') updateState('lineY', v); }} unit="px" compact />
                          </div>
                        </div>

                        {/* 预设3 控制器 */}
                        <div
                          className={cx(
                            'rounded-2xl border p-3 space-y-3',
                            state.linePreset === 'preset3'
                              ? 'border-[#9e76ff] bg-[#9e76ff]/10'
                              : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black">预设 3</div>
                            {state.linePreset === 'preset3' && (
                              <div className="text-[11px] font-black text-[#9e76ff]">已选中</div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <Slider label="条数" min={2} max={5} step={1} value={state.linePreset3Count}
                              onChange={(v) => { updateState('linePreset3Count', v); if (state.linePreset === 'preset3') updateState('lineCount', v); }} compact />
                            <Slider label="厚度" min={10} max={80} step={1} value={state.linePreset3Thickness}
                              onChange={(v) => { updateState('linePreset3Thickness', v); if (state.linePreset === 'preset3') updateState('lineThickness', v); }} unit="px" compact />
                            <Slider label="长度对比" min={0} max={1} step={0.05} value={state.linePreset3LengthContrast}
                              onChange={(v) => { updateState('linePreset3LengthContrast', v); if (state.linePreset === 'preset3') updateState('lineLengthContrast', v); }} compact />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Slider label="位置 X" min={-500} max={500} step={10} value={state.linePreset3X}
                              onChange={(v) => { updateState('linePreset3X', v); if (state.linePreset === 'preset3') updateState('lineX', v); }} unit="px" compact />
                            <Slider label="位置 Y" min={-400} max={400} step={10} value={state.linePreset3Y}
                              onChange={(v) => { updateState('linePreset3Y', v); if (state.linePreset === 'preset3') updateState('lineY', v); }} unit="px" compact />
                          </div>
                        </div>
                      </div>

                      <LineColorDots
                        label="颜色"
                        options={[
                          ...availableGraphicColors.slice(0, 4).map((c) => ({
                            id: c,
                            kind: 'solid' as const,
                            value: c,
                          })),
                          { id: 'sandwich', kind: 'special', value: 'sandwich' },
                          { id: 'sandwich2', kind: 'special', value: 'sandwich2' },
                        ]}
                        selected={
                          state.lineColors.length
                            ? state.lineColors
                            : [availableGraphicColors[0]]
                        }
                        onToggle={(id) => {
                          const curr = state.lineColors.length
                            ? state.lineColors
                            : [availableGraphicColors[0]];
                          const isOn = curr.includes(id);
                          const next = isOn
                            ? curr.filter((x) => x !== id)
                            : curr.length >= 3
                              ? curr
                              : [...curr, id];
                          if (!isOn && curr.length >= 3) {
                            setToast('线条颜色最多只能选择 3 种');
                            return;
                          }
                          updateState(
                            'lineColors',
                            next.length ? next : [availableGraphicColors[0]],
                          );
                        }}
                      />
                      <button
                        type="button"
                        onClick={randomizeLine}
                        className="w-full mt-1 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black shadow-sm hover:bg-[#7e49f4] transition"
                      >
                        随机生成
                      </button>
                    </div>
                  </PanelCard>
                )}

                {state.graphicType === 'plane' && (
                  <PanelCard
                    title="平面参数"
                    icon={<Shuffle size={16} />}
                  >
                    <div className="space-y-4">
                      <Segmented
                        value={state.planeShape}
                        onChange={(v) => updateState('planeShape', v)}
                        options={[
                          { value: 'square', label: '方形' },
                          { value: 'circle', label: '圆形' },
                          { value: 'triangle', label: '多边形' },
                          { value: 'random', label: '随机形状' },
                        ]}
                      />

                      {/* 每种形状的预设按钮 */}
                      <div className="flex gap-2">
                        {(['preset1', 'preset2', 'preset3'] as const).map((p) => {
                          const activePreset =
                            state.planeShape === 'square' ? state.squarePlanePreset
                            : state.planeShape === 'circle' ? state.circlePlanePreset
                            : state.planeShape === 'triangle' ? state.trianglePlanePreset
                            : state.randomPlanePreset;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => applyPlanePreset(p)}
                              className={cx(
                                'flex-1 py-2 rounded-xl text-[12px] font-black transition border',
                                activePreset === p
                                  ? 'bg-[#9e76ff] text-white border-[#9e76ff]'
                                  : 'bg-white text-[#9e76ff] border-[#9e76ff]/40 hover:border-[#9e76ff]',
                              )}
                            >
                              预设 {p.replace('preset', '')}
                            </button>
                          );
                        })}
                      </div>

                      {false && (
                        <Segmented
                          value={state.planeOrder}
                          onChange={(v) => updateState('planeOrder', v)}
                          options={[
                            { value: '1-over-2', label: '1 在上' },
                            { value: '2-over-1', label: '2 在上' },
                          ]}
                        />
                      )}

                      <div
                        className={cx(
                          'h-px bg-slate-100',
                          'hidden',
                        )}
                      />
                      <div
                        className={cx(
                          'space-y-3',
                          'hidden',
                        )}
                      >
                        <FieldLabel
                          label={`图形1（${
                            state.planeShape === 'random'
                              ? planeShapes.s1 === 'square'
                                ? '方形'
                                : planeShapes.s1 === 'circle'
                                  ? '圆形'
                                  : '多边形'
                              : state.planeShape === 'square'
                                ? '方形'
                                : state.planeShape === 'circle'
                                  ? '圆形'
                                  : '多边形'
                          }）`}
                        />
                        <ColorPickDots
                          label="颜色"
                          colors={availableGraphicColors}
                          value={
                            availableGraphicColors.includes(state.plane1.color)
                              ? state.plane1.color
                              : availableGraphicColors[0]
                          }
                          onPick={(c) => setPlaneColor('plane1', c)}
                        />
                        {(state.planeShape === 'random'
                          ? planeShapes.s1
                          : state.planeShape) === 'square' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Slider
                              label="宽度"
                              min={200}
                              max={1800}
                              step={10}
                              value={state.plane1.width}
                              onChange={(v) => updatePlane('plane1', { width: v })}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="高度"
                              min={200}
                              max={1600}
                              step={10}
                              value={state.plane1.height}
                              onChange={(v) =>
                                updatePlane('plane1', { height: v })
                              }
                              unit="px"
                              compact
                            />
                          </div>
                        )}
                        {(state.planeShape === 'random'
                          ? planeShapes.s1
                          : state.planeShape) === 'circle' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Slider
                              label="横向半径"
                              min={80}
                              max={900}
                              step={5}
                              value={Math.round(state.plane1.width / 2)}
                              onChange={(v) =>
                                updatePlane('plane1', { width: v * 2 })
                              }
                              unit="px"
                              compact
                            />
                            <Slider
                              label="纵向半径"
                              min={80}
                              max={650}
                              step={5}
                              value={Math.round(state.plane1.height / 2)}
                              onChange={(v) =>
                                updatePlane('plane1', { height: v * 2 })
                              }
                              unit="px"
                              compact
                            />
                          </div>
                        )}
                        {(state.planeShape === 'random'
                          ? planeShapes.s1
                          : state.planeShape) === 'triangle' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Slider
                              label="变数"
                              min={3}
                              max={10}
                              step={1}
                              value={state.plane1.sides}
                              onChange={(v) =>
                                updatePlane('plane1', { sides: v })
                              }
                              compact
                            />
                            <Slider
                              label="半径"
                              min={80}
                              max={900}
                              step={5}
                              value={state.plane1.radius}
                              onChange={(v) =>
                                updatePlane('plane1', { radius: v })
                              }
                              unit="px"
                              compact
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-3">
                          <Slider
                            label="角度"
                            min={-180}
                            max={180}
                            step={1}
                            value={state.plane1.angle}
                            onChange={(v) => updatePlane('plane1', { angle: v })}
                            unit="°"
                            compact
                          />
                          <Slider
                            label="X"
                            min={0}
                            max={100}
                            step={1}
                            value={state.plane1.x}
                            onChange={(v) => updatePlane('plane1', { x: v })}
                            unit="%"
                            compact
                          />
                          <Slider
                            label="Y"
                            min={0}
                            max={100}
                            step={1}
                            value={state.plane1.y}
                            onChange={(v) => updatePlane('plane1', { y: v })}
                            unit="%"
                            compact
                          />
                        </div>
                      </div>

                      <div
                        className={cx(
                          'h-px bg-slate-100',
                          'hidden',
                        )}
                      />
                      <div
                        className={cx(
                          'space-y-3',
                          'hidden',
                        )}
                      >
                        <FieldLabel
                          label={`图形2（${
                            state.planeShape === 'random'
                              ? planeShapes.s2 === 'square'
                                ? '方形'
                                : planeShapes.s2 === 'circle'
                                  ? '圆形'
                                  : '多边形'
                              : state.planeShape === 'square'
                                ? '方形'
                                : state.planeShape === 'circle'
                                  ? '圆形'
                                  : '多边形'
                          }）`}
                        />
                        <ColorPickDots
                          label="颜色"
                          colors={availableGraphicColors}
                          value={
                            availableGraphicColors.includes(state.plane2.color)
                              ? state.plane2.color
                              : availableGraphicColors[1] || availableGraphicColors[0]
                          }
                          onPick={(c) => setPlaneColor('plane2', c)}
                        />
                        {(state.planeShape === 'random'
                          ? planeShapes.s2
                          : state.planeShape) === 'square' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Slider
                              label="宽度"
                              min={200}
                              max={1800}
                              step={10}
                              value={state.plane2.width}
                              onChange={(v) => updatePlane('plane2', { width: v })}
                              unit="px"
                              compact
                            />
                            <Slider
                              label="高度"
                              min={200}
                              max={1600}
                              step={10}
                              value={state.plane2.height}
                              onChange={(v) =>
                                updatePlane('plane2', { height: v })
                              }
                              unit="px"
                              compact
                            />
                          </div>
                        )}
                        {(state.planeShape === 'random'
                          ? planeShapes.s2
                          : state.planeShape) === 'circle' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Slider
                              label="横向半径"
                              min={80}
                              max={900}
                              step={5}
                              value={Math.round(state.plane2.width / 2)}
                              onChange={(v) =>
                                updatePlane('plane2', { width: v * 2 })
                              }
                              unit="px"
                              compact
                            />
                            <Slider
                              label="纵向半径"
                              min={80}
                              max={650}
                              step={5}
                              value={Math.round(state.plane2.height / 2)}
                              onChange={(v) =>
                                updatePlane('plane2', { height: v * 2 })
                              }
                              unit="px"
                              compact
                            />
                          </div>
                        )}
                        {(state.planeShape === 'random'
                          ? planeShapes.s2
                          : state.planeShape) === 'triangle' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Slider
                              label="变数"
                              min={3}
                              max={10}
                              step={1}
                              value={state.plane2.sides}
                              onChange={(v) =>
                                updatePlane('plane2', { sides: v })
                              }
                              compact
                            />
                            <Slider
                              label="半径"
                              min={80}
                              max={900}
                              step={5}
                              value={state.plane2.radius}
                              onChange={(v) =>
                                updatePlane('plane2', { radius: v })
                              }
                              unit="px"
                              compact
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-3">
                          <Slider
                            label="角度"
                            min={-180}
                            max={180}
                            step={1}
                            value={state.plane2.angle}
                            onChange={(v) => updatePlane('plane2', { angle: v })}
                            unit="°"
                            compact
                          />
                          <Slider
                            label="X"
                            min={0}
                            max={100}
                            step={1}
                            value={state.plane2.x}
                            onChange={(v) => updatePlane('plane2', { x: v })}
                            unit="%"
                            compact
                          />
                          <Slider
                            label="Y"
                            min={0}
                            max={100}
                            step={1}
                            value={state.plane2.y}
                            onChange={(v) => updatePlane('plane2', { y: v })}
                            unit="%"
                            compact
                          />
                        </div>
                      </div>



                        <button
                        type="button"
                        onClick={randomizePlanes}
                        className="w-full mt-1 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black shadow-sm hover:bg-[#7e49f4] transition"
                      >
                        随机生成
                      </button>
                    </div>
                  </PanelCard>
                )}

                {state.graphicType === 'svg' && (
                  <PanelCard
                    title="手动上传"
                    icon={<ImageIcon size={16} />}
                    right={
                      <span className="text-[11px] font-black text-slate-500">
                        {state.uploadedSvgs.length}/4
                      </span>
                    }
                  >
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/svg+xml"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#9e76ff] text-white text-[13px] font-black hover:bg-[#7e49f4] transition"
                      >
                        <ImageIcon size={18} />
                        上传 SVG
                      </button>
                      {state.uploadedSvgs.length > 0 && (
                        <div className="space-y-2">
                          {state.uploadedSvgs.map((s, idx) => (
                            <div
                              key={s.id}
                              className="px-3 py-3 rounded-2xl border border-slate-200 bg-white space-y-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[12px] font-black text-slate-800">
                                  图形 {idx + 1}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateState(
                                      'uploadedSvgs',
                                      state.uploadedSvgs.filter(
                                        (x) => x.id !== s.id,
                                      ),
                                    )
                                  }
                                  className="w-10 h-10 rounded-2xl border border-slate-200 hover:bg-slate-50 flex items-center justify-center"
                                  aria-label={`删除图形 ${idx + 1}`}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>

                              <Slider
                                label="大小"
                                min={0.2}
                                max={3}
                                step={0.05}
                                value={s.scale}
                                onChange={(v) => updateSvg(s.id, { scale: v })}
                                compact
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <Toggle
                                  checked={s.flipH}
                                  onChange={(v) => updateSvg(s.id, { flipH: v })}
                                  label="水平翻转"
                                />
                                <Toggle
                                  checked={s.flipV}
                                  onChange={(v) => updateSvg(s.id, { flipV: v })}
                                  label="垂直翻转"
                                />
                              </div>
                            </div>
                          ))}
                          <div className="text-[12px] text-slate-500">
                            提示：拖拽 SVG 可在画布上移动位置。
                          </div>
                        </div>
                      )}
                    </div>
                  </PanelCard>
                )}
              </motion.div>
            )}
            {activeTab === 'output' && (
              <motion.div
                key="output"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <PanelCard title="选择导出格式" icon={<Download size={16} />}>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => exportImage('png')}
                      disabled={isExporting}
                      className="rounded-3xl border border-slate-200 bg-white p-5 flex flex-col items-center gap-2 text-slate-900 disabled:opacity-60"
                    >
                      <ImageIcon size={28} />
                      <div className="text-[14px] font-black">导出 PNG</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => exportImage('jpeg')}
                      disabled={isExporting}
                      className="rounded-3xl border border-slate-200 bg-white p-5 flex flex-col items-center gap-2 text-slate-900 disabled:opacity-60"
                    >
                      <ImageIcon size={28} />
                      <div className="text-[14px] font-black">导出 JPG</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => exportSvg()}
                      disabled={isExporting}
                      className="col-span-2 rounded-3xl border border-slate-200 bg-white p-5 flex items-center justify-center gap-3 text-slate-900 disabled:opacity-60"
                    >
                      <FileCode size={26} />
                      <div className="text-[14px] font-black">导出矢量 SVG</div>
                    </button>
                  </div>
                  {isExporting && (
                    <div className="mt-3 text-[12px] text-slate-500">
                      正在导出，请稍候…
                    </div>
                  )}
                </PanelCard>

                <PanelCard title="提示" icon={<Info size={16} />}>
                  <div className="text-[12px] text-slate-600 leading-relaxed">
                    导出图片将包含所有图层信息。SVG 导出为矢量格式，适合后期二次编辑。
                  </div>
                </PanelCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
            </>
          )}
      </aside>

      <main
        className="flex-1 bg-slate-200 relative overflow-hidden"
        ref={scalerRef}
      >
        <div
          ref={desktopViewportRef}
          className="absolute inset-0 pt-[88px] px-8 pb-8 flex items-center justify-center overflow-hidden"
        >
          <div
            className="relative shrink-0"
            style={{
              width: `${ARTBOARD_W * scale}px`,
              height: `${ARTBOARD_H * scale}px`,
            }}
          >
            <div
              ref={artboardRef}
              className="shadow-2xl absolute inset-0 overflow-hidden transition-transform duration-100"
              style={{
                width: `${ARTBOARD_W}px`,
                height: `${ARTBOARD_H}px`,
                backgroundColor: state.bgColor,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
          {state.graphicType === 'line' && <LineLayer state={state} />}
          {state.graphicType === 'plane' && <PlaneLayer state={state} />}

          <GuidesLayer visible={state.showGuides} />

          {/* Logo 区域（仅作为预留位置；有 logoSvg 时显示） */}
          <div
            className="absolute z-[200]"
            style={{
              left: `${ARTBOARD_W - 50 - LOGO_BOX.w}px`,
              top: '50px',
              width: `${LOGO_BOX.w}px`,
              height: `${LOGO_BOX.h}px`,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {state.logoSvg ? (
              <img
                className="w-full h-full object-contain"
                src={svgToDataUri(state.logoSvg)}
                alt="logo"
                draggable={false}
              />
            ) : null}
          </div>

          {/* 区域A：主标题限制区域（裁切） */}
          <div
            className="absolute z-30 pointer-events-none overflow-hidden"
            style={{
              left: `${AREA_A.x}px`,
              top: `${AREA_A.y}px`,
              width: `${AREA_A.w}px`,
              height: `${AREA_A.h}px`,
            }}
          >
            <div className="flex flex-col" style={{ gap: `${state.titleGap}px` }}>
              {state.showMainEn && (
                <div
                  style={{
                    fontSize: `${state.mainEnSize}px`,
                    fontFamily: getFontFamily(state.mainEnWeight),
                    lineHeight: state.mainEnLineHeight,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    transform: `translateY(${MAIN_EN_OFFSET_Y}px)`,
                  }}
                >
                  {state.mainEnText}
                </div>
              )}
              {state.showMainZh && (
                <div
                  style={{
                    fontSize: `${state.mainZhSize}px`,
                    fontFamily: getFontFamily(state.mainZhWeight),
                    lineHeight: state.mainZhLineHeight,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {state.mainZhText}
                </div>
              )}
            </div>
          </div>

          {state.graphicType === 'dot' && <DotLayer state={state} />}
          {state.graphicType === 'svg' && (
            <SvgLayer state={state} updateSvg={updateSvg} />
          )}

          {/* 区域B：始终覆盖图形设计部分 */}
          <div
            className="absolute left-0 bottom-0 w-full z-50 px-[50px] flex items-end justify-between"
            style={{
              height: `${AREA_B.h}px`,
              paddingBottom: '28px',
              paddingTop: '28px',
              backgroundColor: state.bgColor,
            }}
          >
            <div
              style={{
                fontSize: `${SUB1_SIZE_PX}px`,
                fontFamily: getFontFamily(state.sub1Weight),
                whiteSpace: 'pre-line',
                transform: `translateY(${SUB1_OFFSET_Y}px)`,
              }}
            >
              {state.sub1Text}
            </div>
            <div
              className="text-right"
              style={{
                fontSize: `${SUB2_SIZE_PX}px`,
                fontFamily: getFontFamily(state.sub2Weight),
                whiteSpace: 'pre-line',
                lineHeight: 1.1,
                transform: `translateY(${SUB2_OFFSET_Y}px)`,
              }}
            >
              {keepMaxLines(state.sub2Text, 2)}
            </div>
          </div>
        </div>
          </div>
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900/90 text-white px-4 py-2 rounded-2xl shadow-lg text-[12px] font-black"
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>
    </div>
  );
}

