import type { DiseaseDto } from '@krishibid/shared';

/**
 * Common crop diseases in Bangladesh, written in the parts a farmer diagnoses in.
 *
 * The first ten match the classifier's labels exactly, so a prediction always has somewhere to
 * land. The rest are here because they are what actually costs farmers a crop in this country and
 * the model does not cover them yet — a page that only described what the model can see would
 * imply those are the only diseases that exist.
 *
 * Every entry says which institution's guidance it follows. Chemical names appear without doses:
 * the correct rate depends on the formulation on the packet and the soil it is going onto, and a
 * number invented here would be the single most harmful thing on this platform. The page sends
 * people to the Krishi Call Centre for that, which is free and staffed by people.
 *
 * Static rather than a collection. It is reference material that changes when the research does,
 * a deploy is a fine way to update it, and keeping it in code means it is reviewed like code.
 */
export const DISEASES: DiseaseDto[] = [
  // ---------------------------------------------------------------- rice
  {
    slug: 'rice__leaf_blast',
    cropSlug: 'rice',
    names: { bn: 'ধানের ব্লাস্ট রোগ', en: 'Rice blast' },
    pathogen: 'Magnaporthe oryzae',
    severity: 'severe',
    season: { bn: 'বোরো ও আমন — ঠান্ডা রাত ও কুয়াশার সময়', en: 'Boro and Aman — cool nights with heavy dew' },
    symptoms: {
      bn: [
        'পাতায় চোখের মতো (নৌকা আকৃতির) দাগ, মাঝখানে ধূসর ও কিনারা বাদামি',
        'দাগগুলো বড় হয়ে মিশে গিয়ে পাতা শুকিয়ে যায়',
        'শিষের গোড়া কালচে হয়ে ভেঙে পড়ে (নেক ব্লাস্ট) — এতেই সবচেয়ে বেশি ক্ষতি',
      ],
      en: [
        'Eye-shaped (boat-shaped) lesions on leaves — grey centre, brown margin',
        'Lesions merge and the leaf dries out',
        'The neck below the panicle blackens and snaps (neck blast) — this is where the yield is actually lost',
      ],
    },
    cause: {
      bn: 'ছত্রাকজনিত রোগ। অতিরিক্ত ইউরিয়া, ঘন রোপণ, দীর্ঘ শিশিরকাল ও ঠান্ডা রাত রোগ বাড়ায়।',
      en: 'A fungus. Excess urea, dense planting, long dew periods and cool nights all make it worse.',
    },
    treatment: {
      bn: [
        'নেক ব্লাস্ট দেখা দেওয়ার আগেই — শিষ বের হওয়ার শুরুতে — ছত্রাকনাশক দিন',
        'ট্রাইসাইক্লাজল বা এজোক্সিস্ট্রোবিন গ্রুপের অনুমোদিত ছত্রাকনাশক ব্যবহার করুন',
        'রোগ দেখা দিলে ইউরিয়া দেওয়া সাময়িক বন্ধ রাখুন',
      ],
      en: [
        'Spray before neck blast appears — at the start of panicle emergence, not after',
        'Use an approved tricyclazole or azoxystrobin group fungicide',
        'Stop applying urea while the disease is active',
      ],
    },
    prevention: {
      bn: [
        'ব্রি উদ্ভাবিত রোগ সহনশীল জাত ব্যবহার করুন',
        'সুষম সার দিন — ইউরিয়া ভাগ করে ৩ কিস্তিতে',
        'জমিতে পানি ধরে রাখুন, শুকিয়ে ফাটতে দেবেন না',
      ],
      en: [
        'Plant a BRRI resistant variety',
        'Balance the fertiliser — split urea across three applications',
        'Keep standing water; do not let the field dry and crack',
      ],
    },
    sources: ['brri', 'dae', 'krishi-call-centre'],
  },
  {
    slug: 'rice__brown_spot',
    cropSlug: 'rice',
    names: { bn: 'ধানের বাদামি দাগ রোগ', en: 'Brown spot of rice' },
    pathogen: 'Bipolaris oryzae',
    severity: 'moderate',
    season: { bn: 'সারা বছর, বিশেষত পুষ্টিহীন ও খরাপ্রবণ জমিতে', en: 'Year round, worst on poor and drought-stressed soil' },
    symptoms: {
      bn: [
        'পাতায় ছোট গোল বা ডিম্বাকার বাদামি দাগ, চারপাশে হলুদ বলয়',
        'দাগের মাঝখান ধূসর, তিলের দানার মতো দেখতে',
        'বেশি হলে চারা মরে যায় এবং দানা চিটা হয়',
      ],
      en: [
        'Small round or oval brown spots with a yellow halo',
        'Grey centres — often described as looking like sesame seeds',
        'Severe infection kills seedlings and leaves grain unfilled',
      ],
    },
    cause: {
      bn: 'ছত্রাকজনিত। মাটিতে পটাশ ও অন্যান্য পুষ্টির ঘাটতি এবং পানির অভাব এই রোগের প্রধান কারণ — এটি মূলত অপুষ্টির রোগ।',
      en: 'A fungus, but fundamentally a hunger disease: potassium and micronutrient deficiency plus water stress are what let it take hold.',
    },
    treatment: {
      bn: [
        'মাটি পরীক্ষা করে ঘাটতি অনুযায়ী পটাশ ও দস্তা দিন',
        'জমিতে পর্যাপ্ত পানি রাখুন',
        'প্রয়োজনে অনুমোদিত ছত্রাকনাশক দিন — তবে সার ঠিক না করলে রোগ ফিরে আসবে',
      ],
      en: [
        'Test the soil and correct the potassium and zinc deficiency',
        'Keep the field properly watered',
        'A fungicide helps, but the disease returns if the nutrition is not fixed',
      ],
    },
    prevention: {
      bn: ['সুস্থ ও শোধিত বীজ ব্যবহার করুন', 'মাটি পরীক্ষা করে সুষম সার দিন', 'জমি শুকিয়ে যেতে দেবেন না'],
      en: ['Use healthy, treated seed', 'Fertilise from a soil test rather than by habit', 'Do not let the field dry out'],
    },
    sources: ['brri', 'srdi', 'dae'],
  },
  {
    slug: 'rice__bacterial_leaf_blight',
    cropSlug: 'rice',
    names: { bn: 'ধানের ব্যাকটেরিয়াজনিত পাতা পোড়া', en: 'Bacterial leaf blight' },
    pathogen: 'Xanthomonas oryzae pv. oryzae',
    severity: 'severe',
    season: { bn: 'আমন — বৃষ্টি ও ঝড়ের পর', en: 'Aman — after rain and storms' },
    symptoms: {
      bn: [
        'পাতার আগা ও কিনারা থেকে হলুদ হয়ে শুকিয়ে যায়, ঢেউ খেলানো কিনারা',
        'সকালে পাতায় দুধের মতো ব্যাকটেরিয়ার ফোঁটা দেখা যায়',
        'চারা অবস্থায় হলে পুরো গাছ শুকিয়ে মরে যায় (ক্রেসেক)',
      ],
      en: [
        'Yellowing that starts at the leaf tip and margin and dries inward, with a wavy edge',
        'Milky bacterial ooze visible on the leaf early in the morning',
        'In seedlings the whole plant wilts and dies (kresek)',
      ],
    },
    cause: {
      bn: 'ব্যাকটেরিয়া। ঝড়-বৃষ্টিতে পাতা ছিঁড়ে গেলে সেই ক্ষত দিয়ে ঢোকে। অতিরিক্ত ইউরিয়া ও জলাবদ্ধতা রোগ বাড়ায়।',
      en: 'A bacterium. It enters through leaf wounds made by wind and rain. Excess urea and standing floodwater make it worse.',
    },
    treatment: {
      bn: [
        'ছত্রাকনাশকে কাজ হয় না — এটি ব্যাকটেরিয়া, ছত্রাক নয়',
        'ইউরিয়া দেওয়া বন্ধ করুন এবং জমির পানি সরিয়ে দিন',
        'উপজেলা কৃষি অফিসে যোগাযোগ করুন — অনুমোদিত ব্যাকটেরিয়ানাশক সীমিত',
      ],
      en: [
        'Fungicides do nothing — this is a bacterium, not a fungus',
        'Stop urea and drain the field',
        'Contact your upazila office; approved bactericides are limited and locally specified',
      ],
    },
    prevention: {
      bn: ['প্রতিরোধী জাত লাগান', 'সুষম সার, অতিরিক্ত ইউরিয়া নয়', 'আক্রান্ত জমির খড় পরের মৌসুমে ব্যবহার করবেন না'],
      en: ['Plant a resistant variety', 'Balanced fertiliser, not extra urea', 'Do not reuse straw from an infected field'],
    },
    sources: ['brri', 'dae', 'krishi-call-centre'],
  },

  // -------------------------------------------------------------- potato
  {
    slug: 'potato__late_blight',
    cropSlug: 'potato',
    names: { bn: 'আলুর নাবি ধ্বসা', en: 'Late blight of potato' },
    pathogen: 'Phytophthora infestans',
    severity: 'severe',
    season: { bn: 'রবি — ডিসেম্বর থেকে জানুয়ারি, কুয়াশা ও ঠান্ডায়', en: 'Rabi — December to January, in fog and cold' },
    symptoms: {
      bn: [
        'পাতার কিনারা ও আগায় পানিতে ভেজার মতো কালচে সবুজ দাগ',
        'ভেজা আবহাওয়ায় দাগের নিচে সাদা ছত্রাকের আস্তরণ',
        'দুই-তিন দিনেই পুরো ক্ষেত পুড়ে যাওয়ার মতো কালো হয়ে যেতে পারে',
      ],
      en: [
        'Water-soaked dark green patches at leaf tips and margins',
        'A white fungal bloom on the underside in wet weather',
        'A whole field can blacken in two or three days',
      ],
    },
    cause: {
      bn: 'ছত্রাকজাতীয় জীব। ঠান্ডা (১০–২০°সে), কুয়াশা ও টানা ভেজা পাতা — এই তিনটি একসঙ্গে হলে রোগ বিস্ফোরকভাবে ছড়ায়।',
      en: 'An oomycete. Cold (10–20°C), fog and leaves that stay wet — those three together and it moves explosively.',
    },
    treatment: {
      bn: [
        'রোগ দেখার সঙ্গে সঙ্গে অনুমোদিত ছত্রাকনাশক দিন — একদিন দেরিও অনেক',
        'ম্যানকোজেব জাতীয় প্রতিরোধমূলক, আর রোগ শুরু হলে সিস্টেমিক গ্রুপ',
        'আক্রান্ত গাছ তুলে মাটিতে পুঁতে ফেলুন, ক্ষেতে ফেলে রাখবেন না',
      ],
      en: [
        'Spray the moment you see it — a single day of delay matters',
        'A protectant such as mancozeb before, a systemic group once it has started',
        'Pull infected plants and bury them; do not leave them in the field',
      ],
    },
    prevention: {
      bn: [
        'সুস্থ ও রোগমুক্ত বীজ আলু ব্যবহার করুন',
        'উঁচু আইলে লাগান যাতে পানি জমে না থাকে',
        'কুয়াশার পূর্বাভাস থাকলে আগেই প্রতিরোধমূলক ছত্রাকনাশক দিন',
      ],
      en: [
        'Start from certified, disease-free seed potato',
        'Plant on ridges so water drains away',
        'Spray protectively when fog is forecast, before symptoms appear',
      ],
    },
    sources: ['bari', 'dae', 'krishi-call-centre'],
  },
  {
    slug: 'potato__early_blight',
    cropSlug: 'potato',
    names: { bn: 'আলুর আগাম ধ্বসা', en: 'Early blight of potato' },
    pathogen: 'Alternaria solani',
    severity: 'moderate',
    season: { bn: 'রবি মৌসুমের শেষ দিকে, গাছ বয়স্ক হলে', en: 'Later in the Rabi season, on ageing plants' },
    symptoms: {
      bn: [
        'পুরনো পাতায় বাদামি গোল দাগ, ভেতরে গাছের বেড়ের মতো কেন্দ্রীভূত বলয়',
        'দাগের চারপাশে হলুদ বলয়',
        'নিচের পাতা থেকে শুরু হয়ে উপরে ওঠে',
      ],
      en: [
        'Brown round spots on older leaves with concentric rings, like a tree stump',
        'A yellow halo around each spot',
        'Starts on the lower leaves and works upward',
      ],
    },
    cause: {
      bn: 'ছত্রাক। দুর্বল ও পুষ্টিহীন গাছে আগে ধরে। নাবি ধ্বসার চেয়ে ধীরে ছড়ায়।',
      en: 'A fungus that takes weak, underfed plants first. Slower moving than late blight.',
    },
    treatment: {
      bn: ['অনুমোদিত ছত্রাকনাশক দিন', 'নাইট্রোজেন সার দিয়ে গাছ সবল রাখুন', 'আক্রান্ত পাতা সরিয়ে ফেলুন'],
      en: ['Apply an approved fungicide', 'Keep the plant vigorous with adequate nitrogen', 'Remove affected leaves'],
    },
    prevention: {
      bn: ['ফসল পর্যায়ক্রম করুন', 'গাছের গোড়ায় পানি দিন, পাতায় নয়', 'জমি পরিষ্কার রাখুন'],
      en: ['Rotate crops', 'Water at the base, not over the leaves', 'Clear crop debris between seasons'],
    },
    sources: ['bari', 'dae'],
  },

  // -------------------------------------------------------------- tomato
  {
    slug: 'tomato__leaf_curl_virus',
    cropSlug: 'tomato',
    names: { bn: 'টমেটোর পাতা কোঁকড়ানো ভাইরাস', en: 'Tomato leaf curl virus' },
    severity: 'severe',
    season: { bn: 'গরম ও শুষ্ক সময়, সাদা মাছি বেশি থাকলে', en: 'Hot dry weather, when whitefly numbers are high' },
    symptoms: {
      bn: [
        'পাতা উপরের দিকে কোঁকড়ে যায় ও ছোট হয়ে আসে',
        'পাতার শিরা হলুদ, গাছ খাটো ও ঝোপালো',
        'ফুল ঝরে যায়, ফল ধরে না বা খুব কম ধরে',
      ],
      en: [
        'Leaves curl upward and stay small',
        'Yellowing between the veins, plant stunted and bushy',
        'Flowers drop and little or no fruit sets',
      ],
    },
    cause: {
      bn: 'ভাইরাস, যা সাদা মাছি (হোয়াইটফ্লাই) বহন করে। গাছ একবার আক্রান্ত হলে আর সারানো যায় না।',
      en: 'A virus carried by whitefly. Once a plant has it, it cannot be cured.',
    },
    treatment: {
      bn: [
        'আক্রান্ত গাছ তুলে ধ্বংস করুন — এটিই সবচেয়ে কার্যকর ব্যবস্থা',
        'সাদা মাছি দমন করুন, নাহলে বাকি গাছেও ছড়াবে',
        'হলুদ আঠালো ফাঁদ ব্যবহার করুন',
      ],
      en: [
        'Pull and destroy infected plants — this is the effective action, not spraying them',
        'Control the whitefly or it moves to the rest of the field',
        'Yellow sticky traps help you see the population before it explodes',
      ],
    },
    prevention: {
      bn: ['প্রতিরোধী জাত লাগান', 'চারা অবস্থায় জাল দিয়ে ঢেকে রাখুন', 'ক্ষেতের আশেপাশে আগাছা পরিষ্কার রাখুন'],
      en: ['Plant a resistant variety', 'Net the nursery bed while seedlings are young', 'Keep weeds down around the field'],
    },
    sources: ['bari', 'dae', 'krishi-call-centre'],
  },
  {
    slug: 'tomato__septoria_leaf_spot',
    cropSlug: 'tomato',
    names: { bn: 'টমেটোর সেপ্টোরিয়া পাতা দাগ', en: 'Septoria leaf spot' },
    pathogen: 'Septoria lycopersici',
    severity: 'moderate',
    season: { bn: 'আর্দ্র ও বৃষ্টির সময়', en: 'Humid and rainy periods' },
    symptoms: {
      bn: [
        'নিচের পাতায় অসংখ্য ছোট গোল দাগ, ধূসর মাঝখান ও গাঢ় বাদামি কিনারা',
        'দাগের মাঝখানে কালো বিন্দু',
        'পাতা হলুদ হয়ে ঝরে পড়ে, ফল রোদে পুড়ে যায়',
      ],
      en: [
        'Many small circular spots on lower leaves — grey centre, dark brown edge',
        'Tiny black specks in the centre of each spot',
        'Leaves yellow and drop, exposing fruit to sunscald',
      ],
    },
    cause: { bn: 'ছত্রাক। বৃষ্টির ছিটায় মাটি থেকে পাতায় ওঠে।', en: 'A fungus splashed up from the soil by rain.' },
    treatment: {
      bn: ['আক্রান্ত নিচের পাতা কেটে সরান', 'অনুমোদিত ছত্রাকনাশক দিন', 'গাছের গোড়ায় খড় বিছিয়ে দিন'],
      en: ['Strip the affected lower leaves', 'Apply an approved fungicide', 'Mulch the base to stop rain splash'],
    },
    prevention: {
      bn: ['গাছে গাছে ফাঁক রাখুন যাতে বাতাস চলে', 'পাতায় পানি দেবেন না', 'ফসল পর্যায়ক্রম করুন'],
      en: ['Space plants so air moves between them', 'Do not water over the leaves', 'Rotate crops'],
    },
    sources: ['bari', 'dae'],
  },

  // ------------------------------------------- beyond what the model sees
  {
    slug: 'brinjal__shoot_and_fruit_borer',
    cropSlug: 'vegetables',
    names: { bn: 'বেগুনের ডগা ও ফল ছিদ্রকারী পোকা', en: 'Brinjal shoot and fruit borer' },
    severity: 'severe',
    season: { bn: 'প্রায় সারা বছর', en: 'Almost year round' },
    symptoms: {
      bn: ['ডগা নেতিয়ে ঝুলে পড়ে ও শুকিয়ে যায়', 'ফলে ছিদ্র, ভেতরে পোকা ও মল', 'ফল কেটে দেখলে ভেতরটা নষ্ট'],
      en: ['Shoots wilt, droop and dry', 'Bore holes in fruit with frass around them', 'Cut fruit open and the inside is ruined'],
    },
    cause: {
      bn: 'পোকা (Leucinodes orbonalis)। বাংলাদেশে বেগুনের একক বৃহত্তম ক্ষতির কারণ, এবং যে কারণে অতিরিক্ত কীটনাশক ব্যবহার হয়।',
      en: 'An insect (Leucinodes orbonalis). The single biggest cause of brinjal loss in Bangladesh, and the reason for most over-spraying on the crop.',
    },
    treatment: {
      bn: [
        'আক্রান্ত ডগা ও ফল হাতে তুলে ধ্বংস করুন — নিয়মিত করলে সবচেয়ে কার্যকর',
        'ফেরোমন ফাঁদ ব্যবহার করুন',
        'বারবার কীটনাশক ছিটালে পোকা সহনশীল হয়ে যায় — কৃষি অফিসের পরামর্শ নিন',
      ],
      en: [
        'Pick and destroy infested shoots and fruit by hand — done regularly this is the most effective single measure',
        'Use pheromone traps',
        'Repeated spraying breeds resistance; ask the extension officer before escalating',
      ],
    },
    prevention: {
      bn: ['ফেরোমন ফাঁদ আগেভাগে বসান', 'ফসল পর্যায়ক্রম করুন', 'মৌসুম শেষে গাছের অবশিষ্টাংশ পুড়িয়ে ফেলুন'],
      en: ['Set pheromone traps early, before numbers build', 'Rotate crops', 'Destroy plant residue at the end of the season'],
    },
    sources: ['bari', 'dae', 'krishi-call-centre'],
  },
  {
    slug: 'jute__stem_rot',
    cropSlug: 'crops',
    names: { bn: 'পাটের কাণ্ড পচা রোগ', en: 'Jute stem rot' },
    pathogen: 'Macrophomina phaseolina',
    severity: 'severe',
    season: { bn: 'খরিফ — গরম ও আর্দ্র সময়', en: 'Kharif — hot and humid' },
    symptoms: {
      bn: ['কাণ্ডে কালচে বাদামি দাগ, পরে পচে যায়', 'গাছ ভেঙে পড়ে', 'আঁশের মান নষ্ট হয়'],
      en: ['Dark brown lesions on the stem that rot through', 'Plants break and fall', 'Fibre quality is ruined'],
    },
    cause: { bn: 'ছত্রাক, বীজ ও মাটি বাহিত। পাটের সবচেয়ে ক্ষতিকর রোগ।', en: 'A seed- and soil-borne fungus. The most damaging disease of jute.' },
    treatment: {
      bn: ['আক্রান্ত গাছ তুলে ফেলুন', 'অনুমোদিত ছত্রাকনাশক দিন', 'জমিতে পানি জমতে দেবেন না'],
      en: ['Remove affected plants', 'Apply an approved fungicide', 'Do not let water stand in the field'],
    },
    prevention: {
      bn: ['বীজ শোধন করে বপন করুন', 'ফসল পর্যায়ক্রম করুন', 'সুস্থ বীজ ব্যবহার করুন'],
      en: ['Treat seed before sowing', 'Rotate crops', 'Start from healthy seed'],
    },
    sources: ['dae', 'krishi-call-centre'],
  },
  {
    slug: 'mango__anthracnose',
    cropSlug: 'fruit',
    names: { bn: 'আমের অ্যানথ্রাকনোজ', en: 'Mango anthracnose' },
    pathogen: 'Colletotrichum gloeosporioides',
    severity: 'moderate',
    season: { bn: 'মুকুল আসা ও বৃষ্টির সময়', en: 'Flowering, and through the rains' },
    symptoms: {
      bn: ['মুকুল কালো হয়ে ঝরে যায়', 'পাতায় ও ফলে কালো দাগ', 'পাকা আমে কালো গর্তের মতো দাগ'],
      en: ['Flower panicles blacken and drop', 'Black spots on leaves and fruit', 'Sunken black lesions on ripening fruit'],
    },
    cause: { bn: 'ছত্রাক। বৃষ্টি ও আর্দ্রতায় দ্রুত ছড়ায়।', en: 'A fungus that spreads fast in rain and humidity.' },
    treatment: {
      bn: ['মুকুল আসার আগে ও পরে অনুমোদিত ছত্রাকনাশক দিন', 'আক্রান্ত ডাল ছেঁটে ফেলুন', 'ঝরে পড়া ফল সরিয়ে ফেলুন'],
      en: ['Spray an approved fungicide before and after flowering', 'Prune out affected branches', 'Clear fallen fruit from under the tree'],
    },
    prevention: {
      bn: ['গাছের ভেতর দিয়ে বাতাস চলার মতো করে ছাঁটাই করুন', 'বাগান পরিষ্কার রাখুন'],
      en: ['Prune so air moves through the canopy', 'Keep the orchard floor clean'],
    },
    sources: ['bari', 'dae'],
  },
];
