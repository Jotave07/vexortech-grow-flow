import type { CSSProperties } from "react";

type ThemeStyle = CSSProperties & {
  "--primary"?: string;
  "--ring"?: string;
  "--accent"?: string;
  "--primary-foreground"?: string;
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const normalizeHexColor = (value: unknown, fallback: string) => {
  const color = String(value ?? "").trim();
  return HEX_COLOR_RE.test(color) ? color : fallback;
};

const readableTextColor = (hex: string) => {
  const normalized = normalizeHexColor(hex, "#b6ff00").slice(1);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.58 ? "#080808" : "#ffffff";
};

export const getStoreThemeStyle = (
  store: { primary_color?: string | null; secondary_color?: string | null } | null | undefined,
): ThemeStyle => {
  const primary = normalizeHexColor(store?.primary_color, "#b6ff00");
  const secondary = normalizeHexColor(store?.secondary_color, "#ffc857");

  return {
    "--primary": primary,
    "--ring": primary,
    "--accent": secondary,
    "--primary-foreground": readableTextColor(primary),
  };
};
