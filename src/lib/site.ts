// Shared site-wide constants. Imported by the scrolly hero, the landing foyer,
// and anywhere else that needs the canonical author list / external links.

export interface Author {
  name: string;
  /** Optional personal website. Omit/leave undefined to render the name as plain text. */
  url?: string;
}

export const AUTHORS: Author[] = [
  { name: 'Jessica Dai', url: 'https://www.jessicad.ai/' },
  { name: 'Sean D. Garcia' },
  { name: 'Emma Pierson' },
  { name: 'Benjamin Recht' },
  { name: 'Nika Haghtalab' },
];

export const PAPER_URL = 'https://arxiv.org/abs/2606.05750';
export const CONTACT_EMAIL = 'jessicadai@berkeley.edu';
export const CODE_URL = 'https://github.com/rchatgpt-pulse/rchatgpt-pulse.github.io';
