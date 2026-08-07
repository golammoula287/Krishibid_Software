import type { AdvisorySourceDto } from '@krishibid/shared';

/**
 * Where Bangladeshi farming advice actually comes from.
 *
 * Every entry is a real institution with a real mandate, listed so that a farmer reading a
 * diagnosis on this screen can see whose guidance it rests on and go to them directly. That
 * matters more here than anywhere else in the product: a wrong answer about a listing costs
 * somebody a trade, and a wrong answer about a pesticide costs somebody a crop.
 *
 * The Krishi Call Centre is first on purpose. It is staffed by people, it is free, and for a
 * farmer standing in a field with a diseased plant it is a better answer than any model on this
 * platform — including ours. A tool that will not point away from itself when something else is
 * better is not advice, it is marketing.
 *
 * Static rather than a collection: these are national institutions, they change on the timescale
 * of government reorganisations, and a deploy is a perfectly good way to update them.
 */
export const ADVISORY_SOURCES: AdvisorySourceDto[] = [
  {
    slug: 'krishi-call-centre',
    names: { bn: 'কৃষি কল সেন্টার', en: 'Krishi Call Centre' },
    kind: 'helpline',
    phone: '16123',
    url: 'http://www.ais.gov.bd',
    about: {
      bn: 'সরকারি কৃষি হেল্পলাইন। যেকোনো মোবাইল থেকে ১৬১২৩ নম্বরে ফোন করে সরাসরি কৃষি কর্মকর্তার সঙ্গে কথা বলুন — বিনামূল্যে।',
      en: 'The government farming helpline. Dial 16123 from any phone in Bangladesh and speak to an agriculture officer — free of charge.',
    },
  },
  {
    slug: 'dae',
    names: { bn: 'কৃষি সম্প্রসারণ অধিদপ্তর (ডিএই)', en: 'Department of Agricultural Extension (DAE)' },
    kind: 'government',
    url: 'http://www.dae.gov.bd',
    about: {
      bn: 'প্রতিটি উপজেলায় কৃষি সম্প্রসারণ কর্মকর্তা রয়েছেন। রোগ নিশ্চিত করতে বা কীটনাশকের সঠিক মাত্রা জানতে আপনার উপজেলা কৃষি অফিসে যোগাযোগ করুন।',
      en: 'Has an extension officer in every upazila. For confirming a diagnosis or getting a correct pesticide dose, your upazila agriculture office is the right place to go.',
    },
  },
  {
    slug: 'brri',
    names: { bn: 'বাংলাদেশ ধান গবেষণা ইনস্টিটিউট (ব্রি)', en: 'Bangladesh Rice Research Institute (BRRI)' },
    kind: 'research',
    url: 'http://www.brri.gov.bd',
    about: {
      bn: 'ধানের জাত, রোগ ও ব্যবস্থাপনা নিয়ে দেশের প্রধান গবেষণা প্রতিষ্ঠান। ধান সংক্রান্ত সব পরামর্শের মূল উৎস।',
      en: "The country's authority on rice varieties, rice disease and rice management. The source behind most rice guidance here.",
    },
  },
  {
    slug: 'bari',
    names: { bn: 'বাংলাদেশ কৃষি গবেষণা ইনস্টিটিউট (বারি)', en: 'Bangladesh Agricultural Research Institute (BARI)' },
    kind: 'research',
    url: 'http://www.bari.gov.bd',
    about: {
      bn: 'ধান ছাড়া অন্যান্য ফসল — আলু, সবজি, ডাল, তেলবীজ, ফল — নিয়ে গবেষণা করে।',
      en: 'Covers every crop except rice — potato, vegetables, pulses, oilseeds and fruit.',
    },
  },
  {
    slug: 'bina',
    names: { bn: 'বাংলাদেশ পরমাণু কৃষি গবেষণা ইনস্টিটিউট (বিনা)', en: 'Bangladesh Institute of Nuclear Agriculture (BINA)' },
    kind: 'research',
    url: 'http://www.bina.gov.bd',
    about: {
      bn: 'লবণ, খরা ও জলাবদ্ধতা সহনশীল জাত উদ্ভাবন করে — উপকূলীয় ও খরাপ্রবণ এলাকার জন্য গুরুত্বপূর্ণ।',
      en: 'Breeds salt-, drought- and flood-tolerant varieties — the ones that matter in the coastal belt and the drought-prone north-west.',
    },
  },
  {
    slug: 'srdi',
    names: { bn: 'মৃত্তিকা সম্পদ উন্নয়ন ইনস্টিটিউট (এসআরডিআই)', en: 'Soil Resource Development Institute (SRDI)' },
    kind: 'research',
    url: 'http://www.srdi.gov.bd',
    about: {
      bn: 'মাটি পরীক্ষা ও সার সুপারিশ। সারের মাত্রা মাটির উপর নির্ভর করে — অনুমানে সার দেওয়ার আগে মাটি পরীক্ষা করান।',
      en: 'Soil testing and fertiliser recommendations. Dose depends on your soil, so a test beats a guess — and beats a general figure from any app.',
    },
  },
  {
    slug: 'ais',
    names: { bn: 'কৃষি তথ্য সার্ভিস (এআইএস)', en: 'Agriculture Information Service (AIS)' },
    kind: 'government',
    url: 'http://www.ais.gov.bd',
    about: {
      bn: 'কৃষি বিষয়ক প্রকাশনা, ভিডিও ও মৌসুমি পরামর্শ প্রকাশ করে।',
      en: 'Publishes the government’s farming guides, videos and seasonal advisories.',
    },
  },
  {
    slug: 'badc',
    names: { bn: 'বাংলাদেশ কৃষি উন্নয়ন কর্পোরেশন (বিএডিসি)', en: 'Bangladesh Agricultural Development Corporation (BADC)' },
    kind: 'government',
    url: 'http://www.badc.gov.bd',
    about: {
      bn: 'মানসম্পন্ন বীজ, সার ও সেচ সহায়তা সরবরাহ করে।',
      en: 'Supplies certified seed, fertiliser and irrigation support.',
    },
  },
];
