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

// TODO: replace with the arXiv URL once posted.
export const PAPER_URL = '/paper.pdf';
export const CONTACT_EMAIL = 'jessicadai@berkeley.edu';
export const CODE_URL = 'https://github.com/jessica-dai/r-chatgpt';
