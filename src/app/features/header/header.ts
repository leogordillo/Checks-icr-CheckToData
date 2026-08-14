import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService, Lang } from '../../core/i18n.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.html',
  styleUrl: './header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  protected readonly i18n = inject(I18nService);

  setLang(lang: Lang): void {
    this.i18n.setLang(lang);
  }
}
