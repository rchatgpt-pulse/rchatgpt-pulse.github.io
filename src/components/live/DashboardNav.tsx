import { NavLink } from 'react-router-dom';
import { shortDate } from '../../lib/format';
import { useLiveStats } from '../../lib/useLiveStats';

function tabStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-heading)',
    fontSize: 21,
    fontWeight: active ? 700 : 600,
    color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
    borderBottom: active ? '2px solid var(--color-text-primary)' : '2px solid transparent',
    paddingBottom: 3,
    textDecoration: 'none',
    lineHeight: 1.1,
  };
}

/** Subnav for the /live family. Sits inline at the top of the main column,
 *  below the shared SiteTopStrip. Dashboard / Simulator tabs on the left, the
 *  daily-volume meta on the right. */
export default function DashboardNav() {
  const { lastDate, postsToday, last7d, last30d } = useLiveStats();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 22,
        paddingBottom: 12,
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <NavLink to="/live" end style={({ isActive }) => tabStyle(isActive)}>
        Dashboard
      </NavLink>
      <NavLink to="/monitor" style={({ isActive }) => tabStyle(isActive)}>
        Try PuLSE
      </NavLink>
      <span style={{ marginLeft: 'auto' }} />
      <div
        className="font-mono text-text-secondary hidden md:flex"
        style={{ fontSize: 12, alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}
      >
        {lastDate && <span>{shortDate(lastDate)}</span>}
        <span>·</span>
        <span>
          <span className="tabular-nums font-semibold text-text-primary">
            {postsToday.toLocaleString()}
          </span>{' '}
          posts today
        </span>
        <span>·</span>
        <span>
          <span className="tabular-nums font-semibold text-text-primary">
            {last7d.toLocaleString()}
          </span>{' '}
          / 7d
        </span>
        <span>·</span>
        <span>
          <span className="tabular-nums font-semibold text-text-primary">
            {last30d.toLocaleString()}
          </span>{' '}
          / 30d
        </span>
      </div>
    </div>
  );
}
