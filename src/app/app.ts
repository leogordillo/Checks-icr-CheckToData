import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HeaderComponent } from './features/header/header';
import { HeroComponent } from './features/hero/hero';
import { CheckDemoComponent } from './features/check-demo/check-demo';
import { HowItWorksComponent } from './features/how-it-works/how-it-works';
import { ProductSpecComponent } from './features/product-spec/product-spec';
import { ContactComponent } from './features/contact/contact';
import { ToastComponent } from './shared/toast/toast';

@Component({
  selector: 'app-root',
  imports: [HeaderComponent, HeroComponent, CheckDemoComponent, HowItWorksComponent, ProductSpecComponent, ContactComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
