/**
 * The RAG corpus.
 *
 * Every document carries a real title/url/section so citations resolve to
 * something a farmer (or an examiner) can actually check. That traceability is
 * the point of the whole pillar — an uncitable answer is indistinguishable from
 * a hallucination.
 *
 * This starter set is intentionally small and hand-written to get the pipeline
 * end-to-end. Before the demo, expand it toward 300–600 chunks from Department
 * of Agricultural Extension (DAE) and BARI publications, keeping the same shape.
 * Only add material you can point at a source for.
 */
export interface KbDocument {
  title: string;
  url: string;
  section?: string;
  cropTags: string[];
  locale: 'bn' | 'en';
  text: string;
}

export const KB_DOCUMENTS: KbDocument[] = [
  {
    title: 'ধানের বাদামী দাগ রোগ ব্যবস্থাপনা',
    url: 'https://dae.gov.bd/site/page/rice-brown-spot',
    section: 'লক্ষণ ও প্রতিকার',
    cropTags: ['rice'],
    locale: 'bn',
    text: `ধানের বাদামী দাগ রোগ (Brown Spot) একটি ছত্রাকজনিত রোগ, যা Bipolaris oryzae ছত্রাক দ্বারা সৃষ্ট হয়।

লক্ষণ: পাতায় ছোট, গোলাকার থেকে ডিম্বাকার বাদামী দাগ দেখা যায়। দাগের কেন্দ্র ধূসর বা সাদা এবং চারপাশে গাঢ় বাদামী বলয় থাকে। রোগ বেশি হলে দাগগুলো মিশে গিয়ে পাতা শুকিয়ে যায়। শীষে আক্রমণ হলে চাল কালচে হয় এবং ওজন কমে যায়।

অনুকূল পরিবেশ: এই রোগ সাধারণত পুষ্টি ঘাটতি, বিশেষ করে পটাশ ও সিলিকনের অভাবে বেশি হয়। জমিতে পানির অভাব এবং ৭০ শতাংশের বেশি আপেক্ষিক আর্দ্রতা রোগ বিস্তারে সহায়ক।

প্রতিকার: রোগমুক্ত ও সুস্থ বীজ ব্যবহার করতে হবে। বীজ বপনের আগে বীজ শোধন করা জরুরি। জমিতে সুষম সার প্রয়োগ করতে হবে এবং পটাশ সারের ঘাটতি পূরণ করতে হবে। আক্রান্ত জমিতে পানি ধরে রাখতে হবে। রোগের তীব্রতা বেশি হলে অনুমোদিত ছত্রাকনাশক সুপারিশকৃত মাত্রায় প্রয়োগ করতে হবে — সঠিক মাত্রার জন্য স্থানীয় কৃষি সম্প্রসারণ কর্মকর্তার পরামর্শ নিন।`,
  },
  {
    title: 'ধানের ব্লাস্ট রোগ',
    url: 'https://dae.gov.bd/site/page/rice-blast',
    section: 'শনাক্তকরণ ও দমন',
    cropTags: ['rice'],
    locale: 'bn',
    text: `ধানের ব্লাস্ট রোগ Magnaporthe oryzae ছত্রাক দ্বারা সৃষ্ট। এটি ধানের সবচেয়ে ক্ষতিকর রোগগুলোর একটি।

লক্ষণ: পাতায় চোখের মত (নৌকা আকৃতির) দাগ পড়ে, দাগের মাঝখানে ধূসর এবং কিনারা বাদামী বা লালচে। গিঁটে আক্রমণ হলে গাছ ভেঙে পড়ে। শীষের গোড়ায় আক্রমণ হলে পুরো শীষ সাদা হয়ে যায় এবং চিটা হয়।

অনুকূল পরিবেশ: রাতে ঠান্ডা ও দিনে গরম, দীর্ঘ সময় পাতা ভেজা থাকা, এবং অতিরিক্ত নাইট্রোজেন সার প্রয়োগ রোগ বাড়ায়।

প্রতিকার: রোগ সহনশীল জাত চাষ করা সর্বোত্তম উপায়। অতিরিক্ত ইউরিয়া প্রয়োগ থেকে বিরত থাকতে হবে এবং কয়েক কিস্তিতে ভাগ করে দিতে হবে। জমি আগাছামুক্ত রাখতে হবে। আক্রান্ত হলে অনুমোদিত ছত্রাকনাশক প্রয়োগ করতে হবে; প্রয়োগের মাত্রা ও সময় সম্পর্কে কৃষি কর্মকর্তার পরামর্শ নেওয়া আবশ্যক।`,
  },
  {
    title: 'আলুর নাবি ধ্বসা রোগ',
    url: 'https://bari.gov.bd/site/page/potato-late-blight',
    section: 'লক্ষণ ও প্রতিরোধ',
    cropTags: ['potato'],
    locale: 'bn',
    text: `আলুর নাবি ধ্বসা (Late Blight) রোগ Phytophthora infestans দ্বারা সৃষ্ট এবং বাংলাদেশে আলুর সবচেয়ে বড় ক্ষতির কারণ।

লক্ষণ: পাতার কিনারা ও আগা থেকে পানিতে ভেজার মত কালচে সবুজ দাগ শুরু হয়, পরে দ্রুত বাদামী-কালো হয়ে যায়। পাতার নিচে সাদা তুলার মত ছত্রাকের বৃদ্ধি দেখা যায়। আক্রমণ তীব্র হলে ২–৩ দিনে পুরো ক্ষেত পুড়ে যাওয়ার মত দেখায়। কন্দে বাদামী পচন ধরে।

অনুকূল পরিবেশ: ১০–২০ ডিগ্রি সেলসিয়াস তাপমাত্রা, কুয়াশা, মেঘলা আকাশ ও উচ্চ আর্দ্রতা। ডিসেম্বর–জানুয়ারিতে ঝুঁকি সবচেয়ে বেশি।

প্রতিরোধ: সুস্থ ও রোগমুক্ত বীজ আলু ব্যবহার করতে হবে। উঁচু জমিতে চাষ করে পানি নিষ্কাশনের ব্যবস্থা রাখতে হবে। গাছের ঘনত্ব কম রাখলে বাতাস চলাচল ভালো হয়। কুয়াশা বা মেঘলা আবহাওয়া শুরু হলে আগাম সতর্কতা হিসেবে অনুমোদিত ছত্রাকনাশক স্প্রে করতে হবে। আক্রান্ত গাছ তুলে ধ্বংস করতে হবে। সঠিক ছত্রাকনাশক ও মাত্রা জানার জন্য স্থানীয় উপসহকারী কৃষি অফিসারের সঙ্গে যোগাযোগ করুন।`,
  },
  {
    title: 'টমেটোর পাতা কোঁকড়ানো ভাইরাস',
    url: 'https://bari.gov.bd/site/page/tomato-leaf-curl',
    section: 'ব্যবস্থাপনা',
    cropTags: ['tomato'],
    locale: 'bn',
    text: `টমেটোর পাতা কোঁকড়ানো রোগ (Tomato Leaf Curl Virus) সাদা মাছি (whitefly) দ্বারা বাহিত একটি ভাইরাস রোগ।

লক্ষণ: পাতা ছোট হয়ে উপরের দিকে কোঁকড়ে যায়, পাতার কিনারা হলুদ হয়। গাছের বৃদ্ধি থেমে যায় এবং গাছ বেঁটে হয়ে যায়। ফুল ঝরে পড়ে ও ফল ধরা কমে যায়। আগাম আক্রমণে ফলন প্রায় সম্পূর্ণ নষ্ট হতে পারে।

ব্যবস্থাপনা: ভাইরাস রোগের সরাসরি কোনো রাসায়নিক প্রতিকার নেই, তাই বাহক সাদা মাছি নিয়ন্ত্রণই প্রধান উপায়। চারা অবস্থায় নেট দিয়ে ঢেকে রাখতে হবে। আক্রান্ত গাছ দেখা মাত্র তুলে মাটিতে পুঁতে ফেলতে হবে। ক্ষেতে ও আশপাশে আগাছা পরিষ্কার রাখতে হবে, কারণ আগাছা ভাইরাসের আশ্রয়স্থল। হলুদ আঠালো ফাঁদ ব্যবহার করে সাদা মাছির সংখ্যা কমানো যায়। সহনশীল জাত পাওয়া গেলে তা ব্যবহার করা উত্তম।`,
  },
  {
    title: 'Balanced Fertiliser Use for Rice',
    url: 'https://dae.gov.bd/site/page/rice-fertiliser',
    section: 'Nutrient management',
    cropTags: ['rice'],
    locale: 'en',
    text: `Balanced fertilisation is the single most cost-effective way to raise rice yields without raising disease pressure.

Nitrogen should be applied in split doses rather than all at once. A single heavy urea application produces soft, dark green foliage that is highly attractive to leaf-folder and far more susceptible to blast. Splitting the dose across basal, early tillering and panicle initiation stages improves uptake efficiency and reduces losses to volatilisation.

Potassium is routinely under-applied in Bangladesh. Adequate potash strengthens cell walls, improves lodging resistance and materially reduces brown spot incidence. Fields showing repeated brown spot should be tested for potassium deficiency before any fungicide is considered.

Zinc deficiency appears as bronzing between leaf veins on young plants, most commonly on calcareous soils and in fields that have been continuously cropped. It is corrected with a soil application at land preparation.

Organic matter, from well-decomposed cowdung or compost, improves soil structure and water-holding capacity. It is a slow intervention and works alongside — not instead of — mineral fertiliser.

Exact quantities depend on soil test results, the variety grown and the season. Consult your Sub-Assistant Agriculture Officer for a recommendation specific to your field; blanket doses waste money and can do harm.`,
  },
  {
    title: 'Post-Harvest Handling and Storage Losses',
    url: 'https://dae.gov.bd/site/page/post-harvest',
    section: 'Reducing losses',
    cropTags: ['rice', 'potato', 'onion', 'wheat'],
    locale: 'en',
    text: `Post-harvest losses in Bangladesh are estimated at a substantial share of production and are usually cheaper to prevent than additional yield is to grow.

Grain moisture is the controlling variable for stored cereals. Paddy stored above roughly 14 percent moisture is at risk of mould growth, discolouration and insect infestation. Drying on a clean, raised surface rather than bare earth prevents contamination and re-absorption of ground moisture.

Potatoes require the opposite emphasis: they need curing in a shaded, well-ventilated space so that harvest wounds heal before storage. Storing undried or damaged tubers with sound ones spreads soft rot rapidly through the whole stock. Bruised tubers should be separated and sold first.

Onions need thorough curing and good airflow. Stacking them deep in a closed room traps the moisture they release and causes neck rot.

Timing the sale matters as much as the storage itself. Selling immediately at harvest, when every farmer in the district is selling, is when prices are lowest. Being able to store safely for even a few weeks is what converts a storage investment into a better price.`,
  },
  {
    title: 'Integrated Pest Management Basics',
    url: 'https://dae.gov.bd/site/page/ipm-basics',
    section: 'Principles',
    cropTags: ['rice', 'tomato', 'potato', 'chili'],
    locale: 'en',
    text: `Integrated Pest Management (IPM) treats pesticide as the last option rather than the first, which lowers cost and slows the development of resistance.

Start by monitoring. Walk the field regularly and count what you actually find; treatment is justified only when pest numbers cross an economic threshold, not when the first insect appears. Spraying on a calendar schedule wastes money and kills the natural enemies that were suppressing the pest for free.

Cultural controls come next: resistant varieties, clean seed, proper spacing for airflow, removal of crop residue and weeds that harbour pests, and crop rotation to break pest life cycles.

Mechanical and biological controls are often sufficient on their own. Light traps, yellow sticky traps for whitefly and aphid, pheromone traps for fruit borer, and hand removal of egg masses all reduce pressure without chemicals. Perches for insect-eating birds in rice fields are a well-established low-cost measure.

If a chemical is genuinely needed, use only an approved product for that pest and crop, at the recommended dose, and rotate between different modes of action. Under-dosing accelerates resistance; over-dosing endangers the applicator and leaves residue. Always observe the pre-harvest interval, and never mix products without advice. Obtain the specific product and dose from your local extension officer.`,
  },
  {
    title: 'পাটের চাষাবাদ পদ্ধতি',
    url: 'https://dae.gov.bd/site/page/jute-cultivation',
    section: 'বপন ও পরিচর্যা',
    cropTags: ['jute'],
    locale: 'bn',
    text: `পাট বাংলাদেশের অর্থকরী ফসল। সঠিক সময়ে বপন ও পরিচর্যা ফলন ও আঁশের গুণাগুণ দুটোই বাড়ায়।

বপনের সময়: দেশি পাট (Corchorus capsularis) চৈত্র-বৈশাখ মাসে এবং তোষা পাট (Corchorus olitorius) বৈশাখ-জ্যৈষ্ঠ মাসে বপন করা হয়। আগাম বপনে গাছ বেশি লম্বা হয় ও আঁশের পরিমাণ বাড়ে।

জমি তৈরি: জমি ভালোভাবে চাষ ও মাটি ঝুরঝুরে করতে হবে। পানি নিষ্কাশনের ব্যবস্থা থাকা জরুরি, কারণ পাটের চারা জলাবদ্ধতা সহ্য করতে পারে না।

পরিচর্যা: বপনের ১৫–২০ দিনের মধ্যে প্রথম নিড়ানি ও পাতলা করা (thinning) করতে হবে, যাতে গাছের মধ্যে প্রয়োজনীয় দূরত্ব থাকে। ঘন গাছ থাকলে আঁশ সরু ও দুর্বল হয়।

কাটা ও পচানো: ফুল আসার পর্যায়ে পাট কাটলে আঁশের গুণাগুণ সবচেয়ে ভালো হয়। কাটার পর পরিষ্কার, ধীরগতির প্রবাহমান পানিতে জাগ দিতে হবে। কাদাযুক্ত বা স্থির পানিতে জাগ দিলে আঁশে দাগ পড়ে এবং দাম কমে যায়।`,
  },
];
