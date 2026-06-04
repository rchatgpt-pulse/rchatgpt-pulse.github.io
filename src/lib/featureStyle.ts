import type { Feature } from '../types';

export function formatChange(change: number) {
  return `${change.toFixed(1)}x`;
}

export function changeStyle(feature: Feature) {
  const isIncrease = feature.observed_direction === 'increase';
  if (feature.significant) {
    return {
      text: isIncrease ? 'text-increase-700 font-bold' : 'text-decrease-700 font-bold',
      bg: isIncrease ? 'bg-increase-50' : 'bg-decrease-50',
    };
  }
  if (feature.dagger) {
    return {
      text: isIncrease ? 'text-increase-600 font-bold' : 'text-decrease-600 font-bold',
      bg: '',
    };
  }
  return { text: 'text-neutral-400', bg: '' };
}
