import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ResultsComponent, CarLarRow } from './results';
import { PredictResponse } from '../../core/models';

/**
 * The CAR/LAR verdict is the one control where a wrong answer is worse than no answer:
 * the written amount prevails legally, so a fabricated LAR turns a good check into a
 * false "does not match".
 */
describe('ResultsComponent CAR/LAR', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResultsComponent],
      providers: [provideHttpClient()],
    }).compileComponents();
  });

  function rowFor(result: PredictResponse | null): CarLarRow | null {
    const fixture = TestBed.createComponent(ResultsComponent);
    fixture.componentRef.setInput('status', 'results');
    fixture.componentRef.setInput('result', result);
    return (fixture.componentInstance as unknown as { carLarRow: () => CarLarRow | null }).carLarRow();
  }

  function response(
    entities: Record<string, unknown>,
    normalized?: Record<string, unknown>,
  ): PredictResponse {
    return {
      file_name: 'check.jpg',
      entities: entities as PredictResponse['entities'],
      normalized_properties: normalized as PredictResponse['normalized_properties'],
      ocr_source: 'test',
      image_normalization_ms: 0,
      ocr_ms: 0,
      ocr_mapping_ms: 0,
      inference_ms: 0,
      total_processing_ms: 0,
    };
  }

  it('never derives the LAR from the raw words line', () => {
    // The ICR read the handwritten "00/100" as "400"; the backend could not parse it,
    // so it sent no normalized value and no verdict.
    const row = rowFor(
      response(
        {
          AMOUNT: '5,955.00',
          AMOUNT_WORDS: 'Five thousand nine hundred fifty five and 400',
        },
        { amount_normalized: '5955.00' },
      ),
    );

    expect(row).toBeTruthy();
    expect(row!.status).toBe('unknown');
    expect(row!.lar).toBe('—');
  });

  it('uses the normalized LAR when the backend could read it', () => {
    const row = rowFor(
      response(
        {
          AMOUNT: '5,955.00',
          AMOUNT_WORDS: 'Five thousand nine hundred fifty five and 00/100',
          AMOUNT_MATCHES_AMOUNT_WORDS: true,
        },
        { amount_normalized: '5955.00', amount_words_normalized: '5955.00' },
      ),
    );

    expect(row!.status).toBe('match');
    expect(row!.lar).toBe('5,955.00');
  });

  it('still reports a real mismatch', () => {
    const row = rowFor(
      response(
        {
          AMOUNT: '500.00',
          AMOUNT_WORDS: 'Five thousand and 00/100',
          AMOUNT_MATCHES_AMOUNT_WORDS: false,
        },
        { amount_normalized: '500.00', amount_words_normalized: '5000.00' },
      ),
    );

    expect(row!.status).toBe('mismatch');
  });

  it('falls back to comparing the normalized amounts when the API omits the flag', () => {
    const row = rowFor(
      response(
        { AMOUNT: '1,000.00', AMOUNT_WORDS: 'One thousand and 00/100' },
        { amount_normalized: '1000.00', amount_words_normalized: '1000.00' },
      ),
    );

    expect(row!.status).toBe('match');
  });

  it('has no row at all when neither amount was read', () => {
    expect(rowFor(response({}))).toBeNull();
  });
});
