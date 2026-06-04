import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/useData';
import TimeSeriesChart from '../components/TimeSeriesChart';
import type { SectionDef } from '../components/SectionNav';
import { AUTHORS, PAPER_URL } from '../lib/site';
import { getFeatureColor } from '../lib/colors';

// ── Copy (migrated from old HeroSection.tsx) ───────────────────────

const TITLE = 'Three Years of r/ChatGPT';
const SUBTITLE = 'Societal Impact Evaluations from Social Media Data';

const SENTENCES = [
  'Most evaluations of AI systems measure impact or capability in pre-specified domains. But not all impacts are foreseeable, and realized impact can only be understood in the context of real-world usage. What do everyday users have to say about their experiences?',
  "We think it's worth paying attention.",
];

const WE_ANALYZED = (
  <>
    We analyzed r/ChatGPT posts from the first three years of ChatGPT's existence: December 2022 to
    December 2025.
  </>
);

const R_CHATGPT_GENERALLY = (
  <>
    r/ChatGPT generally shows the <em>normalization</em> of ChatGPT as an
    everyday consumer product.
  </>
);

const MEANWHILE = (
  <>
    At the same time, posts mentioning <em>emotional engagement</em> with ChatGPT rise dramatically over the three-year
    timeframe.
  </>
);

const PUBLIC_KNOWN_HEADING = (
  <>
    What happened?
  </>
);

const PK_DRIVER = (
  <>
    A key driver of this growth in emotional engagement overall seems to be related to GPT-4o.
  </>
);

const THIS_WAS_4O = (
  <>
    A key driver of this emotional engagement seems to be related to GPT-4o.
  </>
);

const EXT_1 = (
  <>
    This seems to be months before emotional-health impacts reached widespread public discourse...
  </>
);

const EXT_2 = (
  <>
    ... or before OpenAI seemed to acknowledge the scale of these use cases.
  </>
);

const EXT_FULL = (
  <>
    This seems to be months before emotional-health impacts reached widespread public discourse — or before OpenAI seemed to acknowledge the scale of these use cases.
  </>
);

const WE_PROPOSE = (
  <>
    We propose a simple method that flags this growth as soon as October 2024. (We call it{' '}
    <span style={{ fontVariantCaps: 'small-caps' }}>PuLSE</span>:{' '}
    <em>Public and Longitudinal Signals for Evaluation</em>.)
  </>
);

const DISCLAIM = (
  <>
   Counterfactual outcomes will always be unknown, and Reddit is a limited data source, especially as moderation policies become more sophisticated and users migrate to topic-specific subreddits over time. 
   Nevertheless, it seems like we could have had a better understanding of these emotional-health impacts as they were unfolding — and, perhaps, made different decisions at various points in time — <em>had anyone been paying attention</em>.
   <span className="block mt-4">On the rest of this site, we give a proof of concept for how to do so.
   </span>
  </>
);

const PUBLIC_KNOWN_EVENT_ORDER: string[] = [
  '2024-05-13',  // GPT-4o initial release
  '2024-10-15',  // Alert raised by our algorithm
  '2025-04-29',  // Sycophantic 4o update, virality & rollback
  '2025-08-07',  // GPT-5 release & backlash
];

// One commentary line per event, indexed against PUBLIC_KNOWN_EVENT_ORDER.
const PUBLIC_KNOWN_COMMENTARY: ReactNode[] = [
  'A key driver of this growth in emotional engagement overall seems to be related to GPT-4o.',
  'We propose a method, PuLSE, that could have flagged this growth as soon as October 2024.',
  <>
    You may remember when a sycophantic GPT-4o update went viral, and was {' '}
    <Ext href="https://openai.com/index/sycophancy-in-gpt-4o/">rolled back immediately</Ext>...
  </>,
  <>
    Or when GPT-5 was launched, and drew such a strong backlash that{' '}
    <Ext href="https://x.com/sama/status/1953893841381273969">GPT-4o was reinstated</Ext>...
  </>,
];

const PUBLIC_KNOWN_EVENT_ROWS: Record<string, number> = {
  '2024-05-13': 2,  // GPT-4o (phase 1)
  '2024-08-08': 1,  // GPT-4o system card (phase 2)
  '2024-10-15': 0,  // Alert raised by our algorithm
  '2025-03-21': 2,  // OpenAI RCT (phase 2)
  '2025-04-29': 1,  // Sycophantic 4o update (phase 1)
  '2025-06-12': 1,  // o4-mini rollback + Advanced Voice (phase 2)
  '2025-08-07': 2,  // GPT-5 release & backlash (phase 1)
  '2025-10-01': 0,  // OpenAI econ whitepaper (phase 2)
};

// ── Spotlights ─────────────────────────────────────────────

interface Spotlight {
  // One feature → single-line chart; multiple features → overlay on the same axes
  featureIds: number[];
  title?: string;
  commentary: ReactNode;
  /** ISO dates of category-tagged timeline events to highlight as callouts */
  featuredEventDates?: string[];
  /** Map of event date → callout row (0 = top row, 1 = second row) */
  eventRows?: Record<string, number>;
  /** Secondary markers rendered with the same callout style as the featured
   *  events, but with a caller-supplied label and row (use rows below the
   *  featured events to stack them underneath). Unlike featuredEventDates
   *  these don't require a category tag and always render in the past/gray
   *  style. `date` must match a timeline event's date. */
  minorEvents?: { date: string; label: string; row: number }[];
  /** When true, the chart hover tooltip omits the sample-posts section */
  noHoverExamples?: boolean;
}

const DOMESTICATION_SPOTLIGHTS: Spotlight[] = [
  { featureIds: [117], commentary: 'Remember prompt engineering?' },
  { featureIds: [6], commentary: 'Meanwhile, AI products are no longer mystical...' },
  { featureIds: [11], commentary: '...while savvier users are more discerning about errors.'},
];

const EMOTIONAL_SPOTLIGHTS: Spotlight[] = [
  { featureIds: [9], commentary: '' },
  // Spotlight feature 119 (attachment & companionship) but keep feature 9
  // (therapy) on the chart for context. The LAST id is treated as primary
  // by SpotlightBlock — its interpretation becomes the title.
  { featureIds: [9, 119], commentary: '' },
];

// Same combined therapy+companionship plot across all "publicly known"
// stages — commentary changes per stage, and each stage cumulatively
// reveals one more event from PUBLIC_KNOWN_EVENT_ORDER. Past events render
// gray; the most-recently-revealed event renders in full color.
const PUBLIC_KNOWN_SPOTLIGHTS: Spotlight[] = PUBLIC_KNOWN_COMMENTARY.map((commentary, i) => ({
  featureIds: [9, 119],
  title: '',
  commentary,
  featuredEventDates: PUBLIC_KNOWN_EVENT_ORDER.slice(0, i + 1),
  eventRows: PUBLIC_KNOWN_EVENT_ROWS,
  noHoverExamples: true,
}));

// Stage right after pk-1.5: same therapy+companionship chart but showing only
// the GPT-4o release (gray/past) and the PuLSE alert. The alert is last in the
// order, so it renders the algorithm pin in full (non-muted) green.
const PULSE_ALERT_SPOTLIGHT: Spotlight = {
  featureIds: [9, 119],
  title: '',
  commentary: '',
  featuredEventDates: ['2024-05-13', '2024-10-15'],
  eventRows: PUBLIC_KNOWN_EVENT_ROWS,
  noHoverExamples: true,
};

// Phase 2: keep the algorithm-alert pin visible (as a past/gray event) and
// reveal OpenAI-specific publications one by one — system card, RCT,
// Advanced Voice update, then the economic whitepaper.
const PUBLIC_KNOWN_PHASE2_EVENT_ORDER: string[] = [
  '2024-08-08',  // GPT-4o system card
  '2025-03-21',  // OpenAI RCT on design & affective responses
  '2025-06-12',  // o4-mini rollback + Advanced Voice update
  // '2025-10-01',  // OpenAI econ whitepaper
];

const PUBLIC_KNOWN_PHASE2_COMMENTARY: ReactNode[] = [
  <>
    The{' '}
    <Ext href="https://cdn.openai.com/gpt-4o-system-card.pdf">GPT-4o system card</Ext>{' '}
    devoted ~300 words to 'anthropomorphization and emotional reliance.'
  </>,
  <>
    In early 2025, OpenAI shared a{' '}
    <Ext href="https://openai.com/index/affective-use-study/">RCT</Ext>{' '} on the impacts of chatbot design decisions on affective responses.
  </>,
  <>
    Yet even after 2025 rollbacks, OpenAI continued to ship{' '}
    <Ext href="https://help.openai.com/en/articles/9624314-model-release-notes#h_680309a67b">Advanced Voice updates</Ext>{' '}
    aimed at improving emotional expression.
  </>,
];

const PUBLIC_KNOWN_PHASE2_SPOTLIGHTS: Spotlight[] = PUBLIC_KNOWN_PHASE2_COMMENTARY.map((commentary, i) => ({
  featureIds: [9, 119],
  title: '',
  commentary,
  // Algorithm-alert listed first so it's a "past" gray pin throughout phase 2;
  // the newly-revealed phase-2 event sits at the end and renders as current.
  featuredEventDates: ['2024-10-15', ...PUBLIC_KNOWN_PHASE2_EVENT_ORDER.slice(0, i + 1)],
  eventRows: PUBLIC_KNOWN_EVENT_ROWS,
  noHoverExamples: true,
}));

// ── Stage schema ──────────────────────────────────────────────────────────
// A stage is a fully self-describing cell. To add, remove or reorder a stage,
// just edit the STAGES array below — nothing else uses stage *indices*.

type SectionId = 'hero' | 'domestication' | 'emotional' | 'monitoring' | 'more';
type HeaderMode = 'splash' | 'anchored';

// A "beat" is one keyed piece of narrative copy. The same beat can appear in
// two roles: stacked in the top *anchor* block (cumulative context that has
// already been established) or focused in the *middle* zone (the current line).
// Stages reference beats by the SAME key in both roles, so there's one shared
// vocabulary instead of boolean flags for one role and string keys for the other.
type BeatKey =
  | 'we-analyzed'
  | 'r-chatgpt'
  | 'meanwhile'
  | 'this-was-4o'
  | 'publicly-known'
  | 'pk-driver'
  | 'we-propose'
  | 'ext-1'
  | 'ext-2'
  | 'disclaim';

// Copy shown in the middle (focus) zone, keyed by beat. Each block is always
// in the DOM (so it can fade in/out); only the stage's active `middle` beat is
// visible. `scrollTo` wraps the copy in a ScrollLink to that nav section.
const MIDDLE_BEATS: { key: BeatKey; node: ReactNode; scrollTo?: SectionId }[] = [
  { key: 'r-chatgpt', node: R_CHATGPT_GENERALLY, scrollTo: 'domestication' },
  { key: 'meanwhile', node: MEANWHILE, scrollTo: 'emotional' },
  { key: 'publicly-known', node: PUBLIC_KNOWN_HEADING },
  { key: 'pk-driver', node: PK_DRIVER },
  { key: 'this-was-4o', node: THIS_WAS_4O },
  { key: 'ext-1', node: EXT_1 },
  { key: 'ext-2', node: EXT_2 },
  { key: 'we-propose', node: WE_PROPOSE },
  { key: 'disclaim', node: DISCLAIM },
];

interface Stage {
  /** Opaque id for debugging; not otherwise used */
  id: string;
  /** Which nav section this stage belongs to (for sidebar grouping) */
  section: SectionId;
  /** HeroHeader visibility + vertical position. Undefined = hidden. */
  header?: HeaderMode;
  /** How many items of SENTENCES[] are visible (0 = none) */
  sentences?: number;
  /**
   * Beats stacked in the top anchor block (the context established so far).
   * Rendered in canonical narrative order regardless of array order; within
   * that, `this-was-4o` renders inline after `meanwhile` and `ext-1`/`ext-2` inline
   * after `we-propose` (continuations of the same sentence).
   */
  anchored?: BeatKey[];
  /** The beat focused in the middle zone (one at a time). */
  middle?: BeatKey;
  /** Spotlight chart + commentary in the body zone */
  spotlight?: Spotlight;
  /** Render the row of Paper / Explore / Live buttons below the text. */
  finalButtons?: boolean;
  /** Vertically center the visible content instead of anchoring to the top. */
  centerLayout?: boolean;
}

/**
 * THE SINGLE SOURCE OF TRUTH for the scrollytelling sequence. Each entry
 * describes exactly what the canvas should look like when the user is on
 * that scroll stage. Sections are grouped by the `section` field; the
 * sidebar nav, keyboard navigation, spacer layout and IntersectionObserver
 * all derive from this array.
 *
 * To add a stage: insert a new object. To remove one: delete the line.
 * No indices or hardcoded stage numbers anywhere else in the file.
 */
const STAGES: Stage[] = [
  // ── Overview ─────────────────────────────────────────────
  { id: 'sentence-2',           section: 'hero', header: 'splash', sentences: 2 },
  { id: 'we-analyzed-anchored', section: 'hero', anchored: ['we-analyzed'] },

  // ── Domestication ─────────────────────────────────────────
  { id: 'dom-intro',  section: 'domestication', anchored: ['we-analyzed'], middle: 'r-chatgpt' },
  { id: 'dom-spot-1', section: 'domestication', anchored: ['we-analyzed'], middle: 'r-chatgpt', spotlight: DOMESTICATION_SPOTLIGHTS[0] },
  { id: 'dom-spot-2', section: 'domestication', anchored: ['we-analyzed'], middle: 'r-chatgpt', spotlight: DOMESTICATION_SPOTLIGHTS[1] },
  { id: 'dom-spot-3', section: 'domestication', anchored: ['we-analyzed'], middle: 'r-chatgpt', spotlight: DOMESTICATION_SPOTLIGHTS[2] },

  // ── Emotional engagement ────────────────────────────────────
  { id: 'emo-intro',  section: 'emotional', anchored: ['we-analyzed', 'r-chatgpt'], middle: 'meanwhile' },
  { id: 'emo-spot-1', section: 'emotional', anchored: ['we-analyzed', 'r-chatgpt'], middle: 'meanwhile', spotlight: EMOTIONAL_SPOTLIGHTS[0] },
  { id: 'emo-spot-2', section: 'emotional', anchored: ['we-analyzed', 'r-chatgpt'], middle: 'meanwhile', spotlight: EMOTIONAL_SPOTLIGHTS[1] },

  // "Publicly known" — Monitoring section
  { id: 'pk-whathappened', section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile'], middle: 'publicly-known' },
  { id: 'pk-4o',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile'], middle: 'pk-driver', spotlight: { ...PUBLIC_KNOWN_SPOTLIGHTS[0], commentary: '' } },
  { id: 'pk-4o-otherfeatures',   section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile'], middle: 'pk-driver', spotlight: { ...PUBLIC_KNOWN_SPOTLIGHTS[0], commentary: "(It's worth noting that there are two closely-timed feature releases — memory and advanced voice — but our retrospective analysis finds the GPT-4o release to be a stable changepoint for both topics.)", minorEvents: [
    { date: '2024-04-29', label: 'Memory', row: 3 },
    { date: '2024-07-30', label: 'Advanced Voice Mode', row: 4 },
  ] } },
  { id: 'pk-we-propose',  section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o'], middle: 'we-propose', spotlight: PULSE_ALERT_SPOTLIGHT },
  
  { id: 'pk-earlier',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose'], middle: 'ext-1', spotlight: { ...PUBLIC_KNOWN_SPOTLIGHTS[1], commentary: '' } },
  { id: 'pk-earlier-syc',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose'], middle: 'ext-1', spotlight: PUBLIC_KNOWN_SPOTLIGHTS[2] },
  { id: 'pk-earlier-gpt5',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose'], middle: 'ext-1', spotlight: PUBLIC_KNOWN_SPOTLIGHTS[3] },

  // Phase 2: keep the algorithm-alert pin and add OpenAI publications one by one.
  { id: 'pk-4',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose', 'ext-1'], middle: 'ext-2', spotlight: {... PUBLIC_KNOWN_SPOTLIGHTS[1], commentary:''}},
  { id: 'pk-5',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose', 'ext-1'], middle: 'ext-2', spotlight: PUBLIC_KNOWN_PHASE2_SPOTLIGHTS[0] },
  { id: 'pk-6',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose', 'ext-1'], middle: 'ext-2', spotlight: PUBLIC_KNOWN_PHASE2_SPOTLIGHTS[1] },
  { id: 'pk-7',     section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose', 'ext-1'], middle: 'ext-2', spotlight: PUBLIC_KNOWN_PHASE2_SPOTLIGHTS[2] },

  // Concluding stages
  { id: 'pk-conclude', section: 'monitoring', anchored: ['we-analyzed', 'r-chatgpt', 'meanwhile', 'this-was-4o', 'we-propose', 'ext-1', 'ext-2'] },
  { id: 'pk-conclude-2', section: 'monitoring', middle: 'disclaim', finalButtons: true, centerLayout: true},
];

const TOTAL_STAGES = STAGES.length;

/**
 * Nav dots for the right-side sidebar. Also consumed by ScrollPage.
 * The `id` values line up with the `section` field of STAGES entries —
 * SectionNav observes elements with these ids to decide which dot to light up.
 */
export const SECTIONS: SectionDef[] = [
  { id: 'hero', label: 'Overview' },
  { id: 'domestication', label: 'Domestication' },
  { id: 'emotional', label: 'Emotional engagement' },
  { id: 'monitoring', label: 'Monitoring' },
];

// Section order used for rendering spacer groups (should match SECTIONS).
const SECTION_ORDER: SectionId[] = SECTIONS.map((s) => s.id as SectionId);

// ── Sub-components ──────────────────────────────────────────────

/** External link, styled to match the author links — opens in a new tab. */
function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-current underline-offset-2 hover:text-accent-700 transition-colors"
    >
      {children}
    </a>
  );
}

/**
 * Renders text as a button that smooth-scrolls to a section by id when clicked.
 * Used so the "r/ChatGPT generally…" and "Meanwhile…" anchor lines double as
 * jumps to the top of the Domestication / Emotional Engagement sections.
 */
function ScrollLink({
  to,
  className = '',
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(to)?.scrollIntoView({ behavior: 'smooth' })}
      className={`block w-full text-left cursor-pointer hover:text-accent-700 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

/** Homepage NavLine-style link, used in a horizontal row on the final stage. */
function FinalNavLink({
  to,
  href,
  label,
  external,
}: {
  to?: string;
  href?: string;
  label: string;
  external?: boolean;
}) {
  const className = 'group flex items-baseline justify-between border-b border-border no-underline';
  const style = { padding: '12px 0' } as const;
  const textClass =
    'font-heading font-medium text-text-primary group-hover:text-accent-700 transition-colors';
  const textStyle = { fontSize: 22 } as const;
  const inner = (
    <span className={textClass} style={textStyle}>
      {label} →
    </span>
  );
  if (to) {
    return (
      <Link to={to} className={className} style={style}>
        {inner}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={className}
      style={style}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {inner}
    </a>
  );
}

function HeroHeader() {
  // Title/subtitle/authors stay at the same (splash) size whenever visible.
  // Only the enclosing container's padding-top animates to move the whole
  // block up from roughly-centered to near the top.
  return (
    <div className="text-left">
      <h1 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-bold text-text-primary mb-4 tracking-tight">
        {TITLE}
      </h1>
      <h2 className="font-heading text-lg sm:text-lg lg:text-2xl font-bold text-text-primary mb-4 tracking-tight">
        {SUBTITLE}
      </h2>
      <p className="text-lg sm:text-lg lg:text-xl italic text-text-secondary max-w-2xl">
        {AUTHORS.map((author, i) => {
          const sep = i === 0 ? '' : i === AUTHORS.length - 1 ? ', and ' : ', ';
          return (
            <span key={author.name}>
              {sep}
              {author.url ? (
                <a
                  href={author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-text-muted/40 underline-offset-2 hover:text-accent-600 hover:decoration-accent-600 transition-colors"
                >
                  {author.name}
                </a>
              ) : (
                author.name
              )}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function SentenceList({ visible }: { visible: number }) {
  return (
    <div className="space-y-2">
      {SENTENCES.map((s, i) => {
        const shown = i < visible;
        return (
          <p
            key={i}
            className={`text-base xl:text-lg text-text-secondary transition-all duration-500 ease-out ${
              shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {s}
          </p>
        );
      })}
    </div>
  );
}

// Card padding (p-3 × 2) + border (1px × 2) plus the `mb-2` gap below the
// header line — chrome that doesn't scale with the chart svg.
const CHART_CARD_CHROME = 26;
const CHART_HEADER_HEIGHT = 32;
const MIN_CHART_HEIGHT = 200;
const FALLBACK_CHART_HEIGHT = 370;
const MOBILE_MIN_CHART_HEIGHT = 120;
const MOBILE_FLOOR_CHART_HEIGHT = 88;
const MOBILE_FALLBACK_CHART_HEIGHT = 180;
// Breathing room below the chart card so it doesn't kiss the bottom of the
// sticky viewport on text-heavy stages.
const CHART_BOTTOM_GAP = 32;
const MOBILE_CHART_BOTTOM_GAP = 8;
// Caps chart height to this multiple of its width, so on tall viewports it
// doesn't stretch into an oddly-tall rectangle filling all remaining space.
const MAX_CHART_ASPECT = 0.5;
const MOBILE_MAX_CHART_ASPECT = 0.42;
const SPOTLIGHT_LEGEND_TOP = 32;
const TOUR_LINE_REVEAL_MS = 1700;

function SpotlightBlock({
  spotlight,
  features,
  timeseries,
  timeline,
  examples,
  availableWidth,
  availableHeight,
  revealLineIds,
}: {
  spotlight: Spotlight;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  timeseries: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  timeline: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  examples: Record<string, any[]>;
  availableWidth: number;
  availableHeight: number;
  revealLineIds?: ReadonlySet<number>;
}) {
  // The LAST id in featureIds is treated as the "primary" feature for
  // titling purposes. Lets us keep a context line (e.g. feature 9) on the
  // chart while titling the spotlight after the actual focus (feature 119).
  const primaryFeatureId = spotlight.featureIds[spotlight.featureIds.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primaryFeature = features.find((f: any) => f.id === primaryFeatureId);

  const headerLine = spotlight.title ?? (primaryFeature ? primaryFeature.interpretation : null);

  const headerChrome = headerLine ? CHART_HEADER_HEIGHT : 0;
  const isMobileLayout = availableWidth > 0 && availableWidth < 640;
  let chartHeight: number;
  if (availableHeight > 0 && availableWidth > 0) {
    const bottomGap = isMobileLayout ? MOBILE_CHART_BOTTOM_GAP : CHART_BOTTOM_GAP;
    const minHeight = isMobileLayout ? MOBILE_MIN_CHART_HEIGHT : MIN_CHART_HEIGHT;
    const floorHeight = isMobileLayout ? MOBILE_FLOOR_CHART_HEIGHT : MIN_CHART_HEIGHT;
    const maxAspect = isMobileLayout ? MOBILE_MAX_CHART_ASPECT : MAX_CHART_ASPECT;
    const fit = availableHeight - CHART_CARD_CHROME - headerChrome - bottomGap;
    const aspectCap = maxAspect * availableWidth;
    const preferredHeight = Math.min(fit, aspectCap);
    chartHeight = Math.max(fit < minHeight ? floorHeight : minHeight, preferredHeight);
  } else {
    chartHeight = isMobileLayout ? MOBILE_FALLBACK_CHART_HEIGHT : FALLBACK_CHART_HEIGHT;
  }

  const legendItems = spotlight.featureIds.map((id) => ({
    id,
    color: getFeatureColor(id),
    name: features.find((f) => f.id === id)?.short_name ?? `f${id}`,
  }));

  return (
    <div className="w-full">
      {headerLine && (
        <div className="mb-2">
          <div className="text-md font-semibold text-text-primary">{headerLine}</div>
        </div>
      )}
      <div className="relative">
        <div
          className="absolute right-full mr-2 hidden w-32 flex-col gap-1 overflow-y-auto md:flex"
          style={{ top: SPOTLIGHT_LEGEND_TOP, maxHeight: chartHeight }}
        >
          {legendItems.map((item) => (
            <div key={item.id} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 shrink-0 rounded" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] leading-tight text-text-secondary" style={{ fontFamily: 'var(--font-mono)' }}>
                {item.name}
              </span>
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-xl border border-border p-3">
          <TimeSeriesChart
            timeseries={timeseries}
            features={features}
            selectedIds={spotlight.featureIds}
            timeline={timeline}
            examples={spotlight.noHoverExamples ? undefined : examples}
            height={chartHeight}
            featuredEventDates={spotlight.featuredEventDates}
            eventRows={spotlight.eventRows}
            minorEvents={spotlight.minorEvents}
            showScaleToggle={false}
            yAxisLabel="% of subreddit posts"
            legendVariant="external-desktop"
            revealLineIds={revealLineIds}
          />
        </div>
      </div>
    </div>
  );
}

// ── Stage canvas ───────────────────────────────────────────────

/** Padding above the header, in vh. "splash" pushes the header roughly to
 *  the middle of the viewport; everything else anchors "We analyzed…" just
 *  below the top of the page. The value transitions smoothly via CSS
 *  transition on padding-top. */
function headerPaddingTopVh(stage: Stage): number {
  return stage.header === 'splash' ? 8 : 12;
}

function mobileHeaderPaddingTopSvh(stage: Stage): number {
  return stage.header === 'splash' ? 8 : 7;
}

function StageCanvas({ stage }: { stage: Stage }) {
  const { features, timeseries, timeline, examples } = useData();

  // Measure the body zone (flex-1 within the h-screen sticky canvas) so the
  // spotlight chart can size to whatever vertical space the text blocks
  // above leave behind, while still respecting an aspect-ratio cap so it
  // doesn't stretch into a tall rectangle on tall viewports.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [revealLineIds, setRevealLineIds] = useState<Set<number>>(() => new Set());
  const seenLineIdsRef = useRef<Set<number>>(new Set());
  const revealTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      for (const timeout of revealTimeoutsRef.current) window.clearTimeout(timeout);
    };
  }, []);

  useLayoutEffect(() => {
    const spotlight = stage.spotlight;
    if (!spotlight) {
      setRevealLineIds(new Set());
      return;
    }

    const newIds = spotlight.featureIds.filter((id) => !seenLineIdsRef.current.has(id));
    for (const id of newIds) seenLineIdsRef.current.add(id);
    setRevealLineIds(new Set(newIds));

    if (!newIds.length) return;
    const timeout = window.setTimeout(() => {
      setRevealLineIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
    }, TOUR_LINE_REVEAL_MS);
    revealTimeoutsRef.current.push(timeout);
  }, [stage.id, stage.spotlight]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setBodySize({ width: rect.width, height: rect.height });
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setBodySize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const headerVisible = stage.header !== undefined;
  const sentencesVisible = stage.sentences ?? 0;
  const sentencesBlockVisible = sentencesVisible > 0;

  // The anchor block renders a fixed canonical order of beats; each line is
  // shown only when the stage lists that beat in `anchored`.
  const isAnchored = (key: BeatKey) => stage.anchored?.includes(key) ?? false;
  const anchorVisible = isAnchored('we-analyzed');
  const anchorRChatgpt = isAnchored('r-chatgpt');
  const anchorMeanwhile = isAnchored('meanwhile');
  const anchorThisWas4o = isAnchored('this-was-4o');
  const anchorWePropose = isAnchored('we-propose');
  const anchorExt1 = isAnchored('ext-1');
  const anchorExt2 = isAnchored('ext-2');

  const middle = stage.middle;
  const spotlight = stage.spotlight;
  const centerLayout = stage.centerLayout === true;
  const canvasStyle = centerLayout
    ? undefined
    : ({
      '--stage-pt-mobile': `${mobileHeaderPaddingTopSvh(stage)}svh`,
      '--stage-pt': `${headerPaddingTopVh(stage)}vh`,
    } as CSSProperties);

  return (
    <div
      className={`h-full max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-7xl min-[1900px]:max-w-[120rem] mx-auto px-3 sm:px-4 lg:pl-40 xl:pl-4 w-full flex flex-col items-center transition-all duration-700 ease-out ${centerLayout ? 'justify-center' : 'pt-[var(--stage-pt-mobile)] md:pt-[var(--stage-pt)]'}`}
      style={canvasStyle}
    >
      {/* Header zone: always the same size. Collapses (max-h 0) when the
          header is gone, so "We analyzed…" takes its place in the flow
          without extra vertical gap. */}
      <div
        className={`shrink-0 w-full transition-all duration-700 ease-out ${
          headerVisible
            ? 'opacity-100 max-h-[30rem]'
            : 'opacity-0 -translate-y-4 max-h-0 overflow-hidden pointer-events-none'
        }`}
      >
        <HeroHeader />
      </div>

      {/* Anchor block: "We analyzed…" + optionally the two promoted
          paragraphs below it. Each sub-line collapses independently via
          max-h so the block grows as more lines are added. */}
      <div
        className={`shrink-0 w-full transition-all duration-700 ease-out ${
          anchorVisible
            ? 'opacity-100 translate-y-0 max-h-[24rem]'
            : 'opacity-0 translate-y-2 max-h-0 overflow-hidden pointer-events-none'
        }`}
      >
        <div className="border-b border-border pb-2 space-y-1.5 md:pb-3 md:space-y-2">
          <p className="text-sm md:text-base xl:text-lg text-text-primary font-medium">{WE_ANALYZED}</p>
          <div
            className={`transition-all duration-700 ease-out ${
              anchorRChatgpt ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 overflow-hidden'
            }`}
          >
            <ScrollLink to="domestication" className="text-sm md:text-base text-text-secondary">{R_CHATGPT_GENERALLY}</ScrollLink>
          </div>
          <div
            className={`transition-all duration-700 ease-out ${
              anchorMeanwhile ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 overflow-hidden'
            }`}
          >
            <ScrollLink to="emotional" className="text-sm md:text-base text-text-secondary">
              {MEANWHILE}
              {anchorThisWas4o && <> {THIS_WAS_4O}</>}
            </ScrollLink>
          </div>
          <div
            className={`transition-all duration-700 ease-out ${
              anchorWePropose ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 overflow-hidden'
            }`}
          >
            <p className="text-sm md:text-base text-text-secondary">
              {WE_PROPOSE}
              {anchorExt1 && anchorExt2 ? (
                <> {EXT_FULL}</>
              ) : (
                <>
                  {anchorExt1 && <> {EXT_1}</>}
                  {anchorExt2 && <> {EXT_2}</>}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Middle text zone — every beat is mounted so it can fade in/out; only
          the stage's active `middle` beat is visible. Driven by MIDDLE_BEATS. */}
      <div className="shrink-0 w-full relative min-h-[3rem] mt-4">
        {MIDDLE_BEATS.map(({ key, node, scrollTo }) => (
          <div
            key={key}
            className={`transition-all duration-500 ease-out ${
              middle === key
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-2 pointer-events-none absolute inset-x-0 top-0'
            }`}
          >
            {scrollTo ? (
              <ScrollLink to={scrollTo} className="text-base xl:text-lg text-text-secondary">{node}</ScrollLink>
            ) : (
              <p className="text-base xl:text-lg text-text-secondary">{node}</p>
            )}
          </div>
        ))}
      </div>

      {/* Final action row — Paper / Explore / Live, styled like the
          homepage NavLine links. Only rendered on the last stage. */}
      {stage.finalButtons && (
        <div className="shrink-0 w-full mt-10">
          <div className="grid grid-cols-3 gap-6">
            <FinalNavLink href={PAPER_URL} label="Read the paper" external />
            <FinalNavLink to="/explore" label="Explore topics" />
            <FinalNavLink to="/live" label="Monitor live" />
          </div>
        </div>
      )}

      {/* Commentary slot — sits directly under the middle heading with a
          minimal gap, before the chart title in the body zone below. */}
      <div
        className={`shrink-0 w-full transition-all duration-500 ease-out ${
          spotlight ? 'opacity-100 max-h-32 mt-2' : 'opacity-0 max-h-0 mt-0 overflow-hidden'
        }`}
      >
        {spotlight && (
          <p className="text-sm md:text-base xl:text-lg italic text-[#935d1f]">{spotlight.commentary}</p>
        )}
      </div>

      {/* Body zone — sentence list or spotlight chart */}
      <div ref={bodyRef} className={`w-full relative mt-4 min-h-0 md:mt-6 ${centerLayout ? '' : 'flex-1'}`}>
        {/* Sentence list */}
        <div
          className={`absolute inset-x-0 top-0 transition-opacity duration-500 ${
            sentencesBlockVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <SentenceList visible={sentencesVisible} />
        </div>

        {/* Spotlight chart + commentary */}
        <div
          className={`absolute inset-x-0 top-0 transition-opacity duration-500 ${
            spotlight ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {spotlight && (
            <SpotlightBlock
              spotlight={spotlight}
              features={features}
              timeseries={timeseries}
              timeline={timeline}
              examples={examples}
              availableWidth={bodySize.width}
              availableHeight={bodySize.height}
              revealLineIds={revealLineIds}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

// Every stage is part of the sticky scrolljacked canvas, so the last stage is
// the final pinned one.
const LAST_STICKY_IDX = TOTAL_STAGES - 1;

export default function ScrollyHero() {
  const [activeIdx, setActiveIdx] = useState(0);
  const spacerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stickyWrapperRef = useRef<HTMLDivElement>(null);
  // Ref mirror so the keydown handler (registered once) can read the current
  // index without tearing down the listener on every change. Updated in an
  // effect (not during render) so the ref write happens after commit.
  const activeIdxRef = useRef(0);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

  // IntersectionObserver: activate the stage whose spacer is closest to the
  // viewport mid.
  useEffect(() => {
    const spacers = spacerRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (!spacers.length) return;

    const visible = new Map<number, DOMRectReadOnly>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.stageIdx);
          if (entry.isIntersecting) {
            visible.set(idx, entry.boundingClientRect);
          } else {
            visible.delete(idx);
          }
        }
        if (visible.size === 0) return;
        const viewportMid = window.innerHeight / 2;
        let best: { idx: number; dist: number } | null = null;
        for (const [idx, rect] of visible) {
          const mid = (rect.top + rect.bottom) / 2;
          const dist = Math.abs(mid - viewportMid);
          if (!best || dist < best.dist) {
            best = { idx, dist };
          }
        }
        if (best) setActiveIdx(best.idx);
      },
      { rootMargin: '-40% 0px -40% 0px', threshold: 0 },
    );

    spacers.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Scroll lock: once the reader is past the last sticky stage's center
  // anchor, clamp scrollY back to that anchor so they can't scroll past
  // the final stage.
  useEffect(() => {
    const onScroll = () => {
      const lastSpacer = spacerRefs.current[LAST_STICKY_IDX];
      if (!lastSpacer) return;
      const rect = lastSpacer.getBoundingClientRect();
      const spacerAbsTop = rect.top + window.scrollY;
      const maxScrollY = spacerAbsTop + rect.height / 2 - window.innerHeight / 2;
      if (window.scrollY > maxScrollY) {
        window.scrollTo({ top: maxScrollY });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keyboard navigation: only intercept when the sticky canvas is pinned.
  useEffect(() => {
    const goToIdx = (idx: number) => {
      spacerRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      // Only intercept while the sticky scrolljacked portion is pinned.
      // Once the reader scrolls past it, native scroll takes over.
      const sticky = stickyWrapperRef.current;
      if (!sticky) return;
      const rect = sticky.getBoundingClientRect();
      if (rect.top > 0 || rect.bottom < window.innerHeight) return;

      const current = activeIdxRef.current;
      let next: number;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        if (current >= LAST_STICKY_IDX) {
          // Final stage: block forward scrolling entirely.
          e.preventDefault();
          return;
        }
        next = current + 1;
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        if (current <= 0) return;
        next = current - 1;
      } else if (e.key === 'Home') {
        if (current === 0) return;
        next = 0;
      } else if (e.key === 'End') {
        if (current === LAST_STICKY_IDX) return;
        next = LAST_STICKY_IDX;
      } else {
        return;
      }

      e.preventDefault();
      goToIdx(next);
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const activeStage = STAGES[activeIdx] ?? STAGES[0];

  return (
    <section className="relative">
      {/* Sticky scrolljacked portion. The sticky canvas pins to this wrapper's
          top and unpins once it scrolls past. */}
      <div ref={stickyWrapperRef} className="relative">
        <div className="sticky top-0 z-10 h-[100svh] overflow-clip [overflow-clip-margin:200px] xl:h-screen">
          <StageCanvas stage={activeStage} />
        </div>

        {/* Spacers: one per stage. Grouped by section so SectionNav's
            IntersectionObserver can track each nav target independently.
            Pulled up with -mt so the first spacer aligns with the sticky
            canvas. */}
        <div className="-mt-[100svh] md:-mt-[100vh]">
          {SECTION_ORDER.map((sectionId) => {
            const stagesInSection = STAGES
              .map((s, idx) => ({ s, idx }))
              .filter(({ s }) => s.section === sectionId);
            if (!stagesInSection.length) return null;
            return (
              <div key={sectionId} id={sectionId}>
                {stagesInSection.map(({ s, idx }) => (
                  <div
                    key={s.id}
                    ref={(el) => { spacerRefs.current[idx] = el; }}
                    data-stage-idx={idx}
                    className="h-[64svh] md:h-screen"
                    aria-hidden="true"
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
