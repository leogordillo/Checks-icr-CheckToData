import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../../core/i18n.service';
import { scorePct, tone } from '../../../core/confidence';
import { EndorseResponse } from '../../../core/models';

@Component({
  selector: 'app-endorsement-block',
  templateUrl: './endorsement-block.html',
  styleUrl: './endorsement-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EndorsementBlockComponent {
  protected readonly i18n = inject(I18nService);

  readonly endorse = input.required<EndorseResponse>();

  protected readonly verdict = computed(() => {
    const e = this.endorse();
    const t = this.i18n.t();
    if (e.endorsed && e.score >= 0.8) {
      return { label: t.verdict_valid, color: '#6D42D9', bg: 'rgba(109,66,217,.12)' };
    }
    if (e.endorsed && e.score < 0.8) {
      return { label: t.verdict_illegible, color: '#B45309', bg: 'rgba(180,83,9,.12)' };
    }
    return { label: t.verdict_absent, color: '#B45309', bg: 'rgba(180,83,9,.12)' };
  });

  protected readonly tone = computed(() => tone(this.endorse().score));
  protected readonly scorePct = computed(() => scorePct(this.endorse().score));
  protected readonly isValid = computed(() => this.verdict().label === this.i18n.t().verdict_valid);
}
