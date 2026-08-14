import { ConfidenceTone } from './models';

/**
 * Score tone rule shared across the results section: >=0.95 high (solid
 * green), 0.90-0.94 good (light green), 0.80-0.89 medium (amber), <0.80
 * low (red).
 */
export function tone(score: number): ConfidenceTone {
  if (score >= 0.95) {
    return { level: 'high', bar: '#16A34A', bg: '#EAFAF0', fg: '#15803D', icon: '●', labelKey: 'conf_high' };
  }
  if (score >= 0.9) {
    return { level: 'good', bar: '#4ADE80', bg: '#F0FDF4', fg: '#16A34A', icon: '●', labelKey: 'conf_good' };
  }
  if (score >= 0.8) {
    return { level: 'medium', bar: '#D97706', bg: '#FEF3E4', fg: '#92400E', icon: '!', labelKey: 'conf_med' };
  }
  return { level: 'low', bar: '#DC2626', bg: '#FDE7E7', fg: '#B01D1D', icon: '▼', labelKey: 'conf_low' };
}

export function scorePct(score: number): string {
  return Math.round(score * 100) + '%';
}
