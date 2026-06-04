import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveData } from '../../data/useLiveData';
import { shortDate } from '../../lib/format';
import { useLiveStats } from '../../lib/useLiveStats';
import Eyebrow from './Eyebrow';

/** Small ambient block: "Today on the sub" + a 90-day post-volume sparkline +
 *  a caption with the latest daily count and a link to the /live monitor.
 *  Used in the /tour rail and in /live + /live/simulator inline footers. */
export default function AmbientToday() {
  const { featureSeries } = useLiveData();
  const { lastDate, postsToday } = useLiveStats();

  const sparkline = useMemo(() => {
    if (!featureSeries) return null;
    const { n_posts } = featureSeries;
    const N = n_posts.length;
    const win = n_posts.slice(Math.max(0, N - 90));
    const winMax = Math.max(1, ...win);
    return { win, winMax };
  }, [featureSeries]);

  if (!sparkline) return null;

  const W = 260;
  const H = 36;
  const n = sparkline.win.length;
  const path = sparkline.win
    .map((v, i) => {
      const x = (W * i) / Math.max(1, n - 1);
      const y = H - (v / sparkline.winMax) * (H - 2) - 1;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Eyebrow>Today on r/chatgpt</Eyebrow>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <path d={path} fill="none" stroke="var(--color-text-primary)" strokeWidth="1.1" />
      </svg>
      <div
        className="font-mono text-text-secondary"
        style={{ fontSize: 12, lineHeight: 1.45 }}
      >
        <div>
          <span className="tabular-nums font-semibold text-text-primary">
            {postsToday.toLocaleString()}
          </span>{' '}
          posts on {lastDate ? shortDate(lastDate) : ''}
        </div>
        <Link
          to="/live"
          className="text-text-secondary hover:text-text-primary transition-colors"
          style={{
            borderBottom: '1px solid var(--color-border)',
            paddingBottom: 1,
            alignSelf: 'flex-start',
            textDecoration: 'none',
          }}
        >
          Monitor live →
        </Link>
      </div>
    </div>
  );
}
