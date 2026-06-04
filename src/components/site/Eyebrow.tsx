interface EyebrowProps {
  /** Pixel size for the label. Most uses sit at 11; the topic popover uses 9. */
  size?: number;
  /** Defaults to var(--color-text-muted); use 'secondary' for the slightly
   *  louder grey we use inside content cards. */
  color?: 'muted' | 'secondary';
  className?: string;
  children: React.ReactNode;
}

/** Small uppercase mono label used as a section/section-row preamble. The
 *  same `font-mono` + 0.08em letter-spacing + uppercase combination appeared
 *  ~8 places as ad-hoc inline styles before this. */
export default function Eyebrow({
  size = 11,
  color = 'muted',
  className,
  children,
}: EyebrowProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: size,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: color === 'muted' ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
      }}
    >
      {children}
    </span>
  );
}
