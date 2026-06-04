import { useState } from 'react';
import SectionNav from '../components/SectionNav';
import ScrollyHero, { SECTIONS } from '../sections/ScrollyHero';
import SiteRightRail from '../components/site/SiteRightRail';
import Eyebrow from '../components/site/Eyebrow';
// ExploreSection lives on the standalone /explore route (see ExplorePage).

export default function ScrollPage() {
  // No loading gate: features.json + timeline.json are inlined at build time,
  // so the splash renders immediately. Charts inside ScrollyHero handle
  // empty timeseries/examples until those async JSONs arrive.

  // The rail's Sections block stays hidden on the splash / overview so the
  // intro reads cleanly; it fades in once the reader reaches Domestication
  // and onward. Tracked off SectionNav's existing IntersectionObserver.
  const [activeSection, setActiveSection] = useState(SECTIONS[0]?.id ?? '');
  const showSections = activeSection !== SECTIONS[0]?.id;

  return (
    <div className="flex">
      {/* Left spacer matching the rail width so the main column reads as
          visually centered on wide screens. */}
      <div className="hidden xl:block" style={{ width: 290, flexShrink: 0 }} aria-hidden />
      <main className="flex-1 min-w-0 px-3 py-8 md:px-14 md:py-16">
        <ScrollyHero />
      </main>
      <SiteRightRail showDivider={false}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            opacity: showSections ? 1 : 0,
            pointerEvents: showSections ? 'auto' : 'none',
            transition: 'opacity 300ms ease-out',
          }}
        >
          <Eyebrow>Sections</Eyebrow>
          <SectionNav sections={SECTIONS} variant="inline" onActiveChange={setActiveSection} />
        </div>
      </SiteRightRail>
    </div>
  );
}
