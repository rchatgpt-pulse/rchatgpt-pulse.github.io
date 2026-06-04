import { Link, useLocation } from 'react-router-dom';

const NAV = [
  { label: 'PAPER TOUR', to: '/tour' },
  { label: 'EXPLORE TOPICS', to: '/explore' },
  { label: 'MONITOR LIVE', to: '/live' },
];

function isNavActive(pathname: string, to: string): boolean {
  if (to === '/tour') return pathname.startsWith('/tour');
  if (to === '/explore')
    return (
      pathname.startsWith('/explore') ||
      pathname.startsWith('/feature') ||
      pathname.startsWith('/topic')
    );
  if (to === '/live') return pathname.startsWith('/live') || pathname.startsWith('/monitor');
  return pathname.startsWith(to);
}

/** Shared top strip rendered on every site page except the landing foyer. */
export default function SiteTopStrip() {
  const { pathname } = useLocation();

  if (pathname === '/' || pathname === '') return null;

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 44,
        background: 'color-mix(in oklab, var(--color-bg) 94%, white)',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 36px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <Link
        to="/"
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: '-0.01em',
          color: 'var(--color-text-primary)',
          textDecoration: 'none',
        }}
      >
        r/ChatGPT
      </Link>
      <span
        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)' }}
      >
        /
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {NAV.map((item) => {
          const active = isNavActive(pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                textDecoration: 'none',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
    </nav>
  );
}
