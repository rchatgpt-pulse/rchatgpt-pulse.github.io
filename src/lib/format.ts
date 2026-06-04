// Small display formatters shared by the landing foyer and the live dashboard.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatPct(v: number, digits = 2): string {
  return v.toFixed(digits) + '%';
}

export function formatX(v: number, digits = 1): string {
  return '×' + v.toFixed(digits);
}

/** "2025-11-21" → "Nov 21, 2025" */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "2025-11-21" → "Nov 21" */
export function dayTick(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2025-11-21" → "Nov '25" — for multi-year axes. */
export function monthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} '${String(y).slice(2)}`;
}
