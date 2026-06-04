/* r/ChatGPT — per-feature color palette (86 unique colors from 12 anchors).
   Each category has an oklch anchor; within a category, N colors are spread
   around it by hue (±hueRange/2) and lightness (3-cycle stagger) so adjacent
   indices contrast. Family size N is taken from features.json at runtime, so
   adding/removing features within a category just regenerates that family.
   Within a category, features are sorted by id ascending — colors are stable
   as long as ids don't change. */

const CATEGORY_ANCHORS: Record<string, string> = {
  'Applications':                  '#d97757',
  'emotion':                       '#c45a8c',
  'Advanced usage':                '#c98b2e',
  'Basic use and exploration':     '#b4a04a',
  'Customization':                 '#7b9558',
  'Model or product improvements': '#3f7fb3',
  'Perspectives':                  '#7d6cb0',
  'Product updates':               '#9c4f6f',
  'Short-term bugs':               '#c25450',
  'Subreddit community':           '#a48b3c',
  'Language and terminology':      '#5e9ba8',
  'Jailbreaking & content policy': '#a13e3a',
  'uncategorized':                 '#9a8e72',
  'other':                         '#9a8e72',
};

const FALLBACK = '#9a8e72';

export function categoryColor(category: string | null | undefined): string {
  if (!category) return FALLBACK;
  return CATEGORY_ANCHORS[category] ?? FALLBACK;
}

interface FamilySpec {
  L: number;          // anchor lightness, 0..100
  C: number;          // anchor chroma
  H: number;          // anchor hue, 0..360
  hueRange: number;   // total hue spread (deg)
  lightRange: number; // total lightness spread (%)
}

const FAMILIES: Record<string, FamilySpec> = {
  'Applications':                  { L: 64, C: 0.130, H: 35,  hueRange: 38, lightRange: 16 },
  'Advanced usage':                { L: 65, C: 0.130, H: 70,  hueRange: 30, lightRange: 14 },
  'Perspectives':                  { L: 54, C: 0.100, H: 290, hueRange: 36, lightRange: 14 },
  'emotion':                       { L: 57, C: 0.150, H: 0,   hueRange: 30, lightRange: 14 },
  'Basic use and exploration':     { L: 68, C: 0.100, H: 95,  hueRange: 26, lightRange: 14 },
  'Jailbreaking & content policy': { L: 46, C: 0.140, H: 25,  hueRange: 22, lightRange: 12 },
  'uncategorized':                 { L: 60, C: 0.030, H: 80,  hueRange: 40, lightRange: 16 },
  'Language and terminology':      { L: 63, C: 0.070, H: 215, hueRange: 30, lightRange: 14 },
  'Customization':                 { L: 60, C: 0.080, H: 130, hueRange: 26, lightRange: 14 },
  'Model or product improvements': { L: 55, C: 0.110, H: 240, hueRange: 26, lightRange: 14 },
  'Subreddit community':           { L: 60, C: 0.100, H: 90,  hueRange: 22, lightRange: 14 },
  'Product updates':               { L: 48, C: 0.120, H: 0,   hueRange: 22, lightRange: 12 },
  'Short-term bugs':               { L: 56, C: 0.150, H: 25,  hueRange: 20, lightRange: 12 },
};

function generateFamily(spec: FamilySpec, n: number): string[] {
  if (n <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? (i / (n - 1)) - 0.5 : 0;
    const dh = t * spec.hueRange;
    const lPattern = [0, +1, -1][i % 3];
    const dl = (lPattern * spec.lightRange) / 3;
    const dc = Math.abs(t) > 0.4 ? -0.01 : 0;
    const L = (spec.L + dl).toFixed(1);
    const C = (spec.C + dc).toFixed(3);
    const H = ((spec.H + dh + 360) % 360).toFixed(1);
    out.push(`oklch(${L}% ${C} ${H})`);
  }
  return out;
}

export interface FeatureLike {
  id: number;
  category: string | null | undefined;
}

function buildFeatureColorMap(features: FeatureLike[]): Map<number, string> {
  const map = new Map<number, string>();
  const byCategory = new Map<string, FeatureLike[]>();
  for (const f of features) {
    const cat = f.category ?? 'uncategorized';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(f);
  }
  for (const arr of byCategory.values()) {
    arr.sort((a, b) => a.id - b.id);
  }
  for (const [cat, arr] of byCategory) {
    const spec = FAMILIES[cat];
    if (!spec) {
      for (const f of arr) map.set(f.id, FALLBACK);
      continue;
    }
    const colors = generateFamily(spec, arr.length);
    arr.forEach((f, i) => map.set(f.id, colors[i]));
  }
  return map;
}

let _map: Map<number, string> | null = null;

export function initFeatureColors(features: FeatureLike[]): void {
  _map = buildFeatureColorMap(features);
}

export function featureColor(featureId: number, fallbackCategory?: string): string {
  if (_map) {
    const c = _map.get(featureId);
    if (c) return c;
  }
  return fallbackCategory ? categoryColor(fallbackCategory) : FALLBACK;
}

// Text-readable variant of a feature color: blends toward the theme's primary
// text color so even pale family members stay legible as inline text. Returns
// a CSS color-mix string so it tracks the current theme automatically.
export function featureTextColor(featureId: number, fallbackCategory?: string): string {
  const c = featureColor(featureId, fallbackCategory);
  return `color-mix(in oklab, ${c} 45%, var(--color-text-primary))`;
}
