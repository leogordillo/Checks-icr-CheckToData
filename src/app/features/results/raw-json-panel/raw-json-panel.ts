import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../../core/i18n.service';
import { EndorseResponse, PredictResponse } from '../../../core/models';

@Component({
  selector: 'app-raw-json-panel',
  templateUrl: './raw-json-panel.html',
  styleUrl: './raw-json-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RawJsonPanelComponent {
  protected readonly i18n = inject(I18nService);

  readonly predict = input.required<PredictResponse | null>();
  readonly endorse = input.required<EndorseResponse | null>();

  protected readonly rawJson = computed(() =>
    JSON.stringify({ predict: this.predict(), endorse: this.endorse() }, null, 2),
  );
}
