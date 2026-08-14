import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../../core/i18n.service';
import { scorePct, tone } from '../../../core/confidence';
import { SignatureClassificationResult } from '../../../core/models';

@Component({
  selector: 'app-signature-block',
  templateUrl: './signature-block.html',
  styleUrl: './signature-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignatureBlockComponent {
  protected readonly i18n = inject(I18nService);

  readonly result = input.required<SignatureClassificationResult>();

  protected readonly tone = computed(() => tone(this.result().score));
  protected readonly scorePct = computed(() => scorePct(this.result().score));
  protected readonly detected = computed(() => this.result().signed);
  protected readonly bg = computed(() => (this.detected() ? 'rgba(109,66,217,.10)' : 'rgba(180,83,9,.10)'));
  protected readonly fg = computed(() => (this.detected() ? '#6D42D9' : '#B45309'));
}
