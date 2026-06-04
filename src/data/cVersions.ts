/** §4 PuLSE archive featurizations: four independent M=64 SAEs, each a frozen
 *  archive (no daily updates). Disjoint from the live 128-feature §3 model. */
export type CVersion = 'c0' | 'c1' | 'c2' | 'c3';

export const C_VERSIONS: CVersion[] = ['c0', 'c1', 'c2', 'c3'];

/** Training-through date per archive, for display (paper §4). */
export const C_TRAINED_THROUGH: Record<CVersion, string> = {
  c0: '2023-03-23',
  c1: '2023-09-09',
  c2: '2024-04-04',
  c3: '2025-04-18',
};

const C_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon ’YY" label for an archive's training-cutoff date. */
export function trainedShort(v: CVersion): string {
  const [y, m] = C_TRAINED_THROUGH[v].split('-');
  return `${C_MONTHS[Number(m) - 1]} ’${y.slice(2)}`;
}
