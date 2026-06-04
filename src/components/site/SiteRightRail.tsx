import AmbientToday from './AmbientToday';
import BrandLinks from './BrandLinks';

interface Props {
  /** Top-section content (sections nav on /tour, focus panel on /explore). */
  children: React.ReactNode;
  /** Render the ambient block above brand links at the bottom (default true). */
  showAmbient?: boolean;
  /** Show the vertical border between main content and rail (default true).
   *  /tour opts out so the scrollytelling pane reads as a single canvas. */
  showDivider?: boolean;
}

/** 290px right rail used on /tour and /explore. Page-specific content sits at
 *  the top; an optional ambient block + brand links anchor to the bottom. */
export default function SiteRightRail({ children, showAmbient = true, showDivider = true }: Props) {
  return (
    <aside
      className="hidden xl:flex"
      style={{
        width: 290,
        flexShrink: 0,
        borderLeft: showDivider ? '1px solid var(--color-border)' : 'none',
        padding: '36px 24px',
        flexDirection: 'column',
        gap: 24,
        position: 'sticky',
        top: 44,
        height: 'calc(100vh - 44px)',
        alignSelf: 'flex-start',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {showAmbient && <AmbientToday />}
        {children}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <BrandLinks />
      </div>
    </aside>
  );
}
