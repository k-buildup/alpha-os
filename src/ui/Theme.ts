/**
 * Design System — Theme
 *
 * Central source of truth for all visual tokens: colors, fonts, spacing.
 * Apps never hardcode palette values; they go through Theme.
 */

import type { ColorHex } from "../types/index.js";

// ─── Palette ─────────────────────────────────────────────────────────────────

export interface ThemePalette {
    bg:      string;
    surface: string;
    border:  string;
    muted:   string;
    text:    string;
    text2:   string;
    text3:   string;
    blue:    string;
    accent:  string;
}

const LIGHT_PALETTE: ThemePalette = {
    bg:      "#ffffff",
    surface: "#fafafa",
    border:  "#e4e4e7",
    muted:   "#f4f4f5",
    text:    "#09090b",
    text2:   "#3f3f46",
    text3:   "#a1a1aa",
    blue:    "#3b82f6",
    accent:  "#18181b",
};

const DARK_PALETTE: ThemePalette = {
    bg:      "#18181b",
    surface: "#1c1c1e",
    border:  "#27272a",
    muted:   "#232326",
    text:    "#f4f4f5",
    text2:   "#d4d4d8",
    text3:   "#71717a",
    blue:    "#60a5fa",
    accent:  "#e4e4e7",
};

// ─── Semantic colors (outside palette) ───────────────────────────────────────

export const SemanticColors = {
    danger:         "#ef4444",
    dangerHover:    "#dc2626",
    warning:        "#ca8a04",
    success:        "#22c55e",
    selectionLight: "#eff6ff",
    selectionDark:  "#1e3a5f",
    selHighLight:   "#bfdbfe",
    selHighDark:    "#1e3a5f",
    cursorColor:    "#3b82f6",
    white:          "#ffffff",
} as const;

// ─── Font tokens ─────────────────────────────────────────────────────────────

export const Fonts = {
    ui:    (size: number, weight = 400) => `${weight} ${size}px 'A2G',system-ui`,
    mono:  (size: number) => `${size}px 'Courier New',monospace`,
    emoji: (size: number) => `${size}px sans-serif`,
} as const;

// ─── Spacing tokens ──────────────────────────────────────────────────────────

export const Spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
} as const;

// ─── Theme singleton ─────────────────────────────────────────────────────────

export class Theme {
    private _dark = false;

    get isDark(): boolean { return this._dark; }
    set isDark(v: boolean) { this._dark = v; }

    get palette(): ThemePalette {
        return this._dark ? DARK_PALETTE : LIGHT_PALETTE;
    }

    /** Shorthand: get a palette color as ColorHex */
    color(key: keyof ThemePalette): ColorHex {
        return this.palette[key] as ColorHex;
    }

    /** Cast any string to ColorHex (convenience) */
    static hex(s: string): ColorHex { return s as ColorHex; }

    /** Selection background based on theme */
    get selectionBg(): string {
        return this._dark ? SemanticColors.selectionDark : SemanticColors.selectionLight;
    }
    get selectionHighlight(): string {
        return this._dark ? SemanticColors.selHighDark : SemanticColors.selHighLight;
    }
    /** Current-line highlight */
    get lineHighlight(): string {
        return this._dark ? "#1a1a2e" : "#f0f9ff";
    }
}
