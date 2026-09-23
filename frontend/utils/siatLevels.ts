import { colors } from './theme';

/**
 * Canonical SIAT-CT level -> color name / hex / danger-label mapping.
 *
 * Single source of truth for the frontend: AlertCard, alert detail,
 * AlarmScreen, CycloneAdvisoryCard, and the map marker used to each keep
 * their own copy of this table (different colors AND different label words
 * for the same level). Import from here instead of redefining it.
 *
 * Wording follows the official SIAT-CT scale (color + danger level), not an
 * invented "phase" vocabulary — see `backend/app/features/siat/levels.py`
 * (the two can't literally share code across Python/TypeScript, so keep them
 * in sync by hand when this table changes).
 *
 * Level 1 (AZUL) is informational-only — it never triggers a push
 * (`_NOTIFY_MIN_LEVEL = 2` on the backend) — so it deliberately does NOT use
 * a severity color. `brand-teal`/`brand-cyan` are reserved for map/icon
 * accents (see docs/BRAND.md) and are excluded on purpose; level 1 uses a
 * neutral gray instead so it never competes visually with the levels that
 * actually alert someone.
 */
export type SiatLevel = 1 | 2 | 3 | 4 | 5;

interface SiatLevelInfo {
  /** Official SIAT-CT color name, e.g. "Azul", "Amarillo". */
  color: string;
  /** Hex used to render this level — brand severity tokens for 2-5, neutral gray for 1. */
  hex: string;
  /** Official danger-level label, e.g. "Peligro moderado". */
  danger: string;
}

export const SIAT_LEVELS: Record<SiatLevel, SiatLevelInfo> = {
  1: { color: 'Azul', hex: '#6B7280', danger: 'Peligro mínimo' },
  2: { color: 'Verde', hex: colors.brandGreen, danger: 'Peligro bajo' },
  3: { color: 'Amarillo', hex: colors.brandYellow, danger: 'Peligro moderado' },
  4: { color: 'Naranja', hex: colors.brandOrange, danger: 'Peligro alto' },
  5: { color: 'Rojo', hex: colors.brandRed, danger: 'Peligro máximo' },
};

const FALLBACK: SiatLevelInfo = { color: '—', hex: '#6B7280', danger: 'Desconocido' };

const entryForLevel = (l: number): SiatLevelInfo => SIAT_LEVELS[l as SiatLevel] ?? FALLBACK;

/** Hex color for a SIAT level — use for markers, icons, badges, gradients. */
export const colorForLevel = (l: number): string => entryForLevel(l).hex;

/** Official danger-level label for a SIAT level, e.g. "Peligro moderado". */
export const labelForLevel = (l: number): string => entryForLevel(l).danger;

/** Official SIAT-CT color name for a SIAT level, e.g. "Amarillo". */
export const colorNameForLevel = (l: number): string => entryForLevel(l).color;
