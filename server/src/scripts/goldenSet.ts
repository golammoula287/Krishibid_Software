/**
 * Golden set for RAG retrieval evaluation.
 *
 * Each question is paired with the `expectedUrls` that genuinely answer it. Those
 * URLs are the ground truth — recall is measured by whether a retrieval leg surfaces
 * at least one of them inside the top-k the generator actually sees.
 *
 * Keyed to the documents currently in `kbSources.ts`. When the corpus grows toward
 * the 300–600 chunk target, grow this set with it: an eval set that only covers a
 * fraction of the corpus reports a number that flatters the system.
 *
 * `unanswerable` cases have no expected source on purpose. They test the refusal
 * path — a RAG system that confidently answers a question its corpus cannot support
 * is worse than one that declines, because the farmer cannot tell the difference.
 */
export interface GoldenQuestion {
  id: string;
  question: string;
  locale: 'bn' | 'en';
  cropSlug?: string;
  /** Any one of these in the top-k counts as a hit. Empty = unanswerable. */
  expectedUrls: string[];
  /** Why this question is in the set — keeps the set from drifting into noise. */
  tests: string;
}

const RICE_BROWN_SPOT = 'https://dae.gov.bd/site/page/rice-brown-spot';
const RICE_BLAST = 'https://dae.gov.bd/site/page/rice-blast';
const POTATO_LATE_BLIGHT = 'https://bari.gov.bd/site/page/potato-late-blight';
const TOMATO_LEAF_CURL = 'https://bari.gov.bd/site/page/tomato-leaf-curl';
const RICE_FERTILISER = 'https://dae.gov.bd/site/page/rice-fertiliser';
const POST_HARVEST = 'https://dae.gov.bd/site/page/post-harvest';
const IPM = 'https://dae.gov.bd/site/page/ipm-basics';
const JUTE = 'https://dae.gov.bd/site/page/jute-cultivation';

export const GOLDEN_SET: GoldenQuestion[] = [
  // ---- Bangla, paraphrased: the case dense retrieval should win --------------
  {
    id: 'bn-brown-spot-symptom',
    question: 'ধানের পাতায় বাদামী গোল দাগ পড়ছে, কী করব?',
    locale: 'bn',
    expectedUrls: [RICE_BROWN_SPOT],
    tests: 'paraphrased symptom description, no disease name given — dense leg should carry this',
  },
  {
    id: 'bn-blast-boat-shaped',
    question: 'ধান গাছের পাতায় নৌকার মত দাগ আর শীষ সাদা হয়ে যাচ্ছে',
    locale: 'bn',
    expectedUrls: [RICE_BLAST],
    tests: 'distinctive symptom phrasing without naming blast',
  },
  {
    id: 'bn-late-blight-fast',
    question: 'আলুর ক্ষেত দুই তিন দিনে পুড়ে যাওয়ার মত হয়ে গেছে কেন?',
    locale: 'bn',
    cropSlug: 'potato',
    expectedUrls: [POTATO_LATE_BLIGHT],
    tests: 'crop filter plus paraphrase; checks the filter narrows without killing recall',
  },
  {
    id: 'bn-tomato-curl',
    question: 'টমেটো গাছের পাতা কুঁকড়ে যাচ্ছে, ওষুধ কী দেব?',
    locale: 'bn',
    cropSlug: 'tomato',
    expectedUrls: [TOMATO_LEAF_CURL],
    tests: 'asks for a chemical the source says does not exist — refusal quality matters here',
  },
  {
    id: 'bn-jute',
    question: 'পাট চাষের সময় ও পদ্ধতি কী?',
    locale: 'bn',
    expectedUrls: [JUTE],
    tests: 'straightforward Bangla topical lookup',
  },

  // ---- Exact terms: the case BM25 should win, and dense alone loses ---------
  {
    id: 'en-bipolaris-latin',
    question: 'Bipolaris oryzae',
    locale: 'en',
    expectedUrls: [RICE_BROWN_SPOT],
    tests: 'bare Latin pathogen name — an exact token dense embeddings smear away',
  },
  {
    id: 'en-phytophthora',
    question: 'Phytophthora infestans control',
    locale: 'en',
    expectedUrls: [POTATO_LATE_BLIGHT],
    tests: 'exact pathogen term; the canonical hybrid-beats-dense case',
  },
  {
    id: 'en-magnaporthe',
    question: 'Magnaporthe oryzae symptoms',
    locale: 'en',
    expectedUrls: [RICE_BLAST],
    tests: 'exact pathogen term',
  },

  // ---- English topical ------------------------------------------------------
  {
    id: 'en-fertiliser',
    question: 'How much potash should I apply to rice?',
    locale: 'en',
    cropSlug: 'rice',
    expectedUrls: [RICE_FERTILISER, RICE_BROWN_SPOT],
    tests: 'quantity question; either source is a legitimate hit',
  },
  {
    id: 'en-storage',
    question: 'How do I reduce losses when storing my harvest?',
    locale: 'en',
    expectedUrls: [POST_HARVEST],
    tests: 'topical English lookup',
  },
  {
    id: 'en-ipm',
    question: 'What is integrated pest management?',
    locale: 'en',
    expectedUrls: [IPM],
    tests: 'definitional lookup',
  },

  // ---- Unanswerable: must refuse, not invent -------------------------------
  {
    id: 'unanswerable-price',
    question: 'আজ ঢাকায় ধানের বাজার দর কত?',
    locale: 'bn',
    expectedUrls: [],
    tests: 'live market price — not in the corpus and cannot be; must refuse',
  },
  {
    id: 'unanswerable-subsidy',
    question: 'How do I apply for the government fertiliser subsidy this year?',
    locale: 'en',
    expectedUrls: [],
    tests: 'deferred feature, no source; must refuse rather than guess a process',
  },
  {
    id: 'unanswerable-weather',
    question: 'আগামী সপ্তাহে বৃষ্টি হবে কি?',
    locale: 'bn',
    expectedUrls: [],
    tests: 'forecast data the corpus does not contain',
  },
  {
    id: 'unanswerable-offtopic',
    question: 'Who won the last cricket world cup?',
    locale: 'en',
    expectedUrls: [],
    tests: 'off-topic — must decline rather than answer from parametric memory',
  },
  {
    id: 'unanswerable-dosage-invented',
    question: 'What exact millilitres of Tilt per litre for rice blast?',
    locale: 'en',
    cropSlug: 'rice',
    expectedUrls: [],
    tests: 'the dangerous case: a specific dose the sources deliberately do not give',
  },
];

export const ANSWERABLE = GOLDEN_SET.filter((q) => q.expectedUrls.length > 0);
export const UNANSWERABLE = GOLDEN_SET.filter((q) => q.expectedUrls.length === 0);
