/**
 * The disease library and the institutions behind it.
 *
 * Separate from `diagnosis.ts`, which is about running the model. This is the reference material
 * a farmer reads whether or not the model is loaded — and on a deployment where it is not, this
 * is the whole of what the page can honestly offer.
 */

export interface AdvisorySourceDto {
  slug: string;
  names: { bn: string; en: string };
  /** A helpline is answered by a person, which is worth distinguishing from a website. */
  kind: 'helpline' | 'government' | 'research';
  url: string;
  phone?: string;
  about: { bn: string; en: string };
}

/**
 * One disease, in the parts a farmer diagnoses in.
 *
 * Ordered the way somebody standing in a field works: what am I looking at (symptoms), why is it
 * happening (cause), what do I do now (treatment), how do I avoid it next season (prevention).
 * Presenting a remedy first would answer a question they have not yet asked.
 */
export interface DiseaseDto {
  slug: string;
  cropSlug: string;
  names: { bn: string; en: string };
  /** The pathogen, where there is one. Absent for disorders and pests. */
  pathogen?: string;
  /** How much of a crop this can take, used to order the library and colour the badge. */
  severity: 'low' | 'moderate' | 'severe';
  /** When it typically appears in Bangladesh — the single most useful filter. */
  season: { bn: string; en: string };
  symptoms: { bn: string[]; en: string[] };
  cause: { bn: string; en: string };
  treatment: { bn: string[]; en: string[] };
  prevention: { bn: string[]; en: string[] };
  /** Which institution's guidance this follows — slugs from ADVISORY_SOURCES. */
  sources: string[];
}
