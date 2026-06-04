interface Props {
  /** Daily values to plot. */
  series: number[];
  /** Line + endpoint color. */
  color: string;
  width?: number;
  height?: number;
}

/** Tiny no-axes sparkline. The rightmost point is highlighted with a small
 *  filled circle so the "current value" reads at a glance. */
export default function TopicSparkline({ series, color, width = 290, height = 48 }: Props) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 1e-9);
  const path = series
    .map((v, i) => {
      const x = (width * i) / (series.length - 1);
      const y = height - 4 - ((v - min) / range) * (height - 10);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastY = height - 4 - ((series[series.length - 1] - min) / range) * (height - 10);
  return (
    <svg width={width} height={height} role="img" aria-label="90-day trajectory">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={width} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
