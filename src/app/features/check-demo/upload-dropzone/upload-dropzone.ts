import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../../core/i18n.service';
import { ACCEPTED_INPUT_ATTR, formatBytes, isTiff, validateCheckImage } from '../../../shared/file-validation.util';
import { tiffToPreviewDataUrl } from '../../../shared/tiff-preview.util';

@Component({
  selector: 'app-upload-dropzone',
  templateUrl: './upload-dropzone.html',
  styleUrl: './upload-dropzone.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadDropzoneComponent {
  protected readonly i18n = inject(I18nService);

  readonly label = input.required<string>();
  readonly requiredBadge = input(false);
  readonly hintText = input('');
  readonly file = input<File | null>(null);
  readonly previewUrl = input<string | null>(null);

  readonly fileSelected = output<File>();
  readonly fileCleared = output<void>();

  protected readonly dragOver = signal(false);
  protected readonly errorKey = signal<'err_unsupported_format' | 'err_too_large' | null>(null);
  protected readonly acceptAttr = ACCEPTED_INPUT_ATTR;

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly resolvedPreview = signal<string | null>(null);

  protected readonly mag = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  private static readonly MAG_SIZE = 120;
  private static readonly MAG_ZOOM = 2.8;

  constructor() {
    effect(() => {
      const f = this.file();
      const explicitUrl = this.previewUrl();
      if (explicitUrl) {
        this.resolvedPreview.set(explicitUrl);
        return;
      }
      if (!f) {
        this.resolvedPreview.set(null);
        return;
      }
      if (isTiff(f)) {
        tiffToPreviewDataUrl(f)
          .then((url) => this.resolvedPreview.set(url))
          .catch((err) => {
            // Surfaced rather than swallowed: a silent failure here once hid a prod-only
            // CJS interop bug that left TIFF previews blank with no visible symptom.
            console.error('TIFF preview failed', err);
            this.resolvedPreview.set(null);
          });
      } else {
        const url = URL.createObjectURL(f);
        this.resolvedPreview.set(url);
      }
    });
  }

  protected readonly fileMeta = computed(() => {
    const f = this.file();
    if (!f) return null;
    return { name: f.name, size: formatBytes(f.size) };
  });

  openPicker(): void {
    this.fileInput().nativeElement.click();
  }

  onPickerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openPicker();
    }
  }

  onInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const f = target.files?.[0];
    target.value = '';
    if (f) this.acceptFile(f);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const f = event.dataTransfer?.files?.[0];
    if (f) this.acceptFile(f);
  }

  remove(): void {
    this.errorKey.set(null);
    this.fileCleared.emit();
  }

  onPreviewMouseMove(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.mag.set({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    });
  }

  onPreviewMouseLeave(): void {
    this.mag.set(null);
  }

  protected magStyle(mag: { x: number; y: number; w: number; h: number }): {
    left: string;
    top: string;
    backgroundImage: string;
    backgroundSize: string;
    backgroundPosition: string;
  } {
    const size = UploadDropzoneComponent.MAG_SIZE;
    const zoom = UploadDropzoneComponent.MAG_ZOOM;
    const left = Math.max(0, Math.min(mag.w - size, mag.x - size / 2));
    const top = Math.max(0, Math.min(mag.h - size, mag.y - size / 2));
    return {
      left: `${left}px`,
      top: `${top}px`,
      backgroundImage: `url("${this.resolvedPreview()}")`,
      backgroundSize: `${mag.w * zoom}px ${mag.h * zoom}px`,
      backgroundPosition: `${-(mag.x * zoom) + size / 2}px ${-(mag.y * zoom) + size / 2}px`,
    };
  }

  private acceptFile(f: File): void {
    const error = validateCheckImage(f);
    if (error) {
      this.errorKey.set(error === 'unsupported_format' ? 'err_unsupported_format' : 'err_too_large');
      return;
    }
    this.errorKey.set(null);
    this.fileSelected.emit(f);
  }
}
