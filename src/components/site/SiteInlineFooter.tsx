import BrandLinks from './BrandLinks';

interface Props {
  /** Middle "references" slot: e.g. method / history / raw-data links. */
  extras?: React.ReactNode;
}

/** Bottom-of-page footer for the full-width live pages (/live and
 *  /live/simulator). Page-specific reference links on the left, brand links
 *  on the right. */
export default function SiteInlineFooter({ extras }: Props) {
  return (
    <footer
      style={{
        marginTop: 36,
        paddingTop: 18,
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        gap: 28,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}
    >
      {extras && (
        <div
          className="font-mono text-text-muted"
          style={{ fontSize: 12, display: 'flex', gap: 14, alignItems: 'flex-end' }}
        >
          {extras}
        </div>
      )}
      <span style={{ flex: 1 }} />
      <BrandLinks />
    </footer>
  );
}
