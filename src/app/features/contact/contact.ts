import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, timeout } from 'rxjs/operators';
import { I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/toast.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kept in sync with MAX_LENGTHS in public/contact.php. */
const MAX_LENGTHS = {
  name: 120,
  email: 200,
  company: 160,
  message: 5000,
} as const;

type FieldName = keyof typeof MAX_LENGTHS;
type FieldErrors = Partial<Record<FieldName, string>>;

interface ContactResponse {
  ok: boolean;
  error?: string;
  fields?: Record<string, string>;
}

@Component({
  selector: 'app-contact',
  imports: [FormsModule],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactComponent {
  /** Same-origin: contact.php ships in public/ and lands beside index.html. */
  private static readonly ENDPOINT = 'contact.php';
  private static readonly TIMEOUT_MS = 20_000;

  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  protected name = '';
  protected email = '';
  protected company = '';
  protected message = '';

  /**
   * Honeypot. Hidden from real users, so anything typed here came from a bot and the
   * submission is dropped server-side.
   */
  protected website = '';

  protected readonly errors = signal<FieldErrors>({});
  protected readonly sending = signal(false);

  protected readonly maxLengths = MAX_LENGTHS;
  protected readonly submitLabel = computed(() =>
    this.sending() ? this.i18n.t().f_sending : this.i18n.t().f_submit,
  );

  submit(): void {
    if (this.sending()) return;

    const errors = this.validate();
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.sending.set(true);

    this.http
      .post<ContactResponse>(ContactComponent.ENDPOINT, {
        name: this.name.trim(),
        email: this.email.trim(),
        company: this.company.trim(),
        message: this.message.trim(),
        website: this.website,
      })
      .pipe(
        timeout(ContactComponent.TIMEOUT_MS),
        finalize(() => this.sending.set(false)),
      )
      .subscribe({
        next: () => this.onSuccess(),
        error: (err: unknown) => this.onError(err),
      });
  }

  clearError(field: FieldName): void {
    if (this.errors()[field] === undefined) return;
    this.errors.update(({ [field]: _removed, ...rest }) => rest);
  }

  private validate(): FieldErrors {
    const t = this.i18n.t();
    const errors: FieldErrors = {};

    const name = this.name.trim();
    const email = this.email.trim();
    const company = this.company.trim();
    const message = this.message.trim();

    if (name === '') {
      errors.name = t.err_name_required;
    } else if (name.length > MAX_LENGTHS.name) {
      errors.name = t.err_field_too_long;
    }

    if (email === '' || !EMAIL_RE.test(email)) {
      errors.email = t.err_email;
    } else if (email.length > MAX_LENGTHS.email) {
      errors.email = t.err_field_too_long;
    }

    if (company.length > MAX_LENGTHS.company) {
      errors.company = t.err_field_too_long;
    }

    if (message === '') {
      errors.message = t.err_message_required;
    } else if (message.length > MAX_LENGTHS.message) {
      errors.message = t.err_field_too_long;
    }

    return errors;
  }

  private onSuccess(): void {
    const t = this.i18n.t();
    this.toasts.success(t.contact_ok_title, t.contact_ok_body);
    this.name = '';
    this.email = '';
    this.company = '';
    this.message = '';
    this.errors.set({});
  }

  private onError(err: unknown): void {
    const t = this.i18n.t();

    if (err instanceof HttpErrorResponse) {
      // The server validates independently; surface its per-field verdict when it
      // disagrees with ours rather than showing a generic failure.
      if (err.status === 422 && err.error?.fields) {
        this.errors.set(this.mapServerFieldErrors(err.error.fields));
        return;
      }
      if (err.status === 429) {
        this.toasts.error(t.contact_err_title, t.contact_err_rate);
        return;
      }
    }

    this.toasts.error(t.contact_err_title, t.contact_err_body);
  }

  private mapServerFieldErrors(fields: Record<string, string>): FieldErrors {
    const t = this.i18n.t();
    const errors: FieldErrors = {};

    for (const [field, code] of Object.entries(fields)) {
      if (!(field in MAX_LENGTHS)) continue;
      const key = field as FieldName;

      if (code === 'too_long') {
        errors[key] = t.err_field_too_long;
      } else if (key === 'email') {
        errors.email = t.err_email;
      } else if (key === 'name') {
        errors.name = t.err_name_required;
      } else if (key === 'message') {
        errors.message = t.err_message_required;
      }
    }

    return errors;
  }
}
