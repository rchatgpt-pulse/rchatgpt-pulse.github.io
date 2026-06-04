import { getFeatureColor } from '../../lib/colors';

interface FeatureSwatchProps {
  /** Feature index — resolved through getFeatureColor. Use this for rows
   *  bound to a feature. */
  idx?: number;
  /** Explicit color override; used by chart layer dots that already have
   *  their palette color in hand. */
  color?: string;
  /** Pixel size of the square. */
  size?: number;
  /** Extra style overrides (e.g. marginTop for vertical alignment in a row). */
  style?: React.CSSProperties;
}

/** Small 8×8 color square used as a row's feature swatch. The same shape
 *  appeared as ad-hoc inline styles in the top-8 list, the biggest-changes
 *  rows, and the stacked chart's hover tooltip; one shared primitive keeps
 *  the size/radius consistent. */
export default function FeatureSwatch({
  idx,
  color,
  size = 8,
  style,
}: FeatureSwatchProps) {
  const bg = color ?? (idx != null ? getFeatureColor(idx) : 'transparent');
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 2,
        background: bg,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
