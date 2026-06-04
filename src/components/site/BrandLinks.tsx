import { PAPER_URL, CODE_URL, CONTACT_EMAIL } from '../../lib/site';

/** Paper / Code / Contact utility links. Used at the bottom of every shared
 *  rail and inline footer. */
export default function BrandLinks() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 18,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-secondary)',
      }}
    >
      <BrandLink href={PAPER_URL}>Paper</BrandLink>
      <BrandLink href={CODE_URL}>Code</BrandLink>
      <BrandLink href={`mailto:${CONTACT_EMAIL}`}>Contact</BrandLink>
    </div>
  );
}

function BrandLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target={href.startsWith('mailto:') ? undefined : '_blank'}
      rel="noopener noreferrer"
      style={{
        textDecoration: 'none',
        color: 'inherit',
        borderBottom: '1px solid var(--color-border)',
        paddingBottom: 1,
      }}
      className="hover:text-text-primary transition-colors"
    >
      {children}
    </a>
  );
}
