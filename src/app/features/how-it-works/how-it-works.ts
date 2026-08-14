import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../core/i18n.service';

interface HowStep {
  n: string;
  title: string;
  desc: string;
  cardBg: string;
  accent: string;
}

@Component({
  selector: 'app-how-it-works',
  templateUrl: './how-it-works.html',
  styleUrl: './how-it-works.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HowItWorksComponent {
  protected readonly i18n = inject(I18nService);

  protected readonly steps = computed<HowStep[]>(() => {
    const t = this.i18n.t();
    return [
      { n: '01', title: t['how_1t'], desc: t['how_1d'], cardBg: '#F4FAFA', accent: '#0E9C9C' },
      { n: '02', title: t['how_2t'], desc: t['how_2d'], cardBg: '#F3F6FB', accent: '#4A6BC7' },
      { n: '03', title: t['how_3t'], desc: t['how_3d'], cardBg: '#F5F1FB', accent: '#7A5CD9' },
      { n: '04', title: t['how_4t'], desc: t['how_4d'], cardBg: '#F1EBFA', accent: '#6D42D9' },
      { n: '05', title: t['how_5t'], desc: t['how_5d'], cardBg: '#FBEEF9', accent: '#A6349B' },
    ];
  });
}
