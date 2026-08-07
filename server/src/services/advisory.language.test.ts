import { describe, expect, it } from 'vitest';
import { detectLocale } from './advisory.service.js';

/**
 * Answering in the language the question was asked in.
 *
 * The UI toggle was standing in for this and is a poor proxy: a farmer whose phone is set to
 * English still types Bangla, and being answered in English is being answered in a language they
 * did not use. This is the whole of that fix, so it is worth pinning.
 */
describe('which language to answer in', () => {
  it('answers Bangla in Bangla, whatever the interface is set to', () => {
    expect(detectLocale('ধানের পাতা হলুদ হয়ে যাচ্ছে কেন?', 'en')).toBe('bn');
  });

  it('answers English in English, whatever the interface is set to', () => {
    expect(detectLocale('Why are my rice leaves turning yellow?', 'bn')).toBe('en');
  });

  /**
   * How people actually write: Bangla sentence, English crop and chemical names. The sentence is
   * Bangla, so the answer is Bangla — treating this as English would be the common case handled
   * worst.
   */
  it('treats a mixed question as Bangla, because the sentence is Bangla', () => {
    expect(detectLocale('আমার potato গাছে late blight হয়েছে, কী করব?', 'en')).toBe('bn');
  });

  it('keeps the interface language when the question carries no letters at all', () => {
    // "50 kg?" or a stray "???" — nothing to detect, so do not guess.
    expect(detectLocale('50 ??', 'bn')).toBe('bn');
    expect(detectLocale('50 ??', 'en')).toBe('en');
  });

  it('does not read a stray English word as an English question', () => {
    // A single Latin token inside Bangla is a brand or a unit, not a change of language.
    expect(detectLocale('urea কতটুকু দেব?', 'bn')).toBe('bn');
  });
});
