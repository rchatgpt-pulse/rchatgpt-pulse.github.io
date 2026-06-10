import { Link } from 'react-router-dom';
import BrandLinks from '../components/site/BrandLinks';
import { PAPER_URL } from '../lib/site';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center">
      <div className="w-full max-w-[1280px] mx-auto px-6 py-12 md:px-[88px] md:py-16">
        <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">
          {/* LHS — title + paragraph + citation + utility links */}
          <div>
            <h1
              className="font-heading font-semibold text-text-primary mb-6"
              style={{ fontSize: 56, lineHeight: 1.0, letterSpacing: '-0.015em' }}
            >
              Keeping a pulse on r/ChatGPT
            </h1>
            <p
              className="text-text-secondary mb-7"
              style={{ fontSize: 18, lineHeight: 1.5, maxWidth: 460 }}
            >
              Social media can tell us a lot about the real-world societal impacts of AI systems. 
              What do everyday users have to say about their experiences?
            </p>
            <p className="text-text-muted italic" style={{ fontSize: 13, maxWidth: 460 }}>
              Based on “
              <a
                href={PAPER_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-text-secondary"
              >
                Three Years of r/ChatGPT: Societal Impact Evaluations from Social Media Data
              </a>
              ” (
              <a
                href="https://www.jessicad.ai/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-text-secondary"
              >
                Jessica Dai
              </a>
              ,{' '}
              <a
                href="https://www.linkedin.com/in/seandgarcia/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-text-secondary"
              >
                Sean Garcia
              </a>
              ,{' '}
              <a
                href="https://people.eecs.berkeley.edu/~emmapierson/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-text-secondary"
              >
                Emma Pierson
              </a>
              ,{' '}
              <a
                href="https://people.eecs.berkeley.edu/~brecht/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-text-secondary"
              >
                Benjamin Recht
              </a>
              , and{' '}
              <a
                href="https://people.eecs.berkeley.edu/~nika/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-text-secondary"
              >
                Nika Haghtalab
              </a>
              ; ICML 2026)
            </p>

            {/* Utility links */}
            <div
              className="border-t border-border"
              style={{ marginTop: 28, paddingTop: 16, maxWidth: 460 }}
            >
              <BrandLinks />
            </div>
          </div>

          {/* RHS — nav lines */}
          <div className="flex flex-col" style={{ gap: 4 }}>
            <NavLine to="/tour" label="Paper tour" sub="" />
            <NavLine to="/explore" label="Explore topics" sub="" />
            <NavLine to="/live" label="Monitor live" sub="" />
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLine({ to, label, sub }: { to: string; label: string; sub: string }) {
  return (
    <Link
      to={to}
      className="group flex items-baseline justify-between border-b border-border no-underline"
      style={{ padding: '14px 0' }}
    >
      <span className="font-heading font-medium text-text-primary group-hover:text-accent-700 transition-colors" style={{ fontSize: 26 }}>
        {label} →
      </span>
      <span className="font-mono uppercase text-text-muted" style={{ fontSize: 11, letterSpacing: '0.08em' }}>
        {sub}
      </span>
    </Link>
  );
}

