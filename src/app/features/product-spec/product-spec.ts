import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../core/i18n.service';

@Component({
  selector: 'app-product-spec',
  templateUrl: './product-spec.html',
  styleUrl: './product-spec.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductSpecComponent {
  protected readonly i18n = inject(I18nService);

  protected readonly specs = computed(() => {
    const t = this.i18n.t();
    return [
      { k: t['spec_fields'], v: t['spec_fields_v'] },
      { k: t['spec_formats'], v: t['spec_formats_v'] },
      { k: t['spec_lat'], v: t['spec_lat_v'] },
      { k: t['spec_deploy'], v: t['spec_deploy_v'] },
      { k: t['spec_base'], v: t['spec_base_v'] },
      { k: t['spec_api'], v: t['spec_api_v'] },
      { k: t['spec_sec'], v: t['spec_sec_v'] },
    ];
  });
}
