/**
 * The authoritative catalogue of user-facing messages, keyed by the stable error `code`
 * every API failure carries.
 *
 * Server-side on purpose. Wording changes — and Bangla wording especially, which will need
 * iteration with real farmers — become a data change deployed with the API, not a client
 * rebuild. It also guarantees one source of truth: the client cannot drift into showing a
 * message for a code the server no longer emits.
 *
 * The client fetches this once, caches it, and keeps a small built-in fallback for the
 * handful of codes that fire when the network is unavailable — a PWA that must fetch a
 * message in order to say "you are offline" is broken by construction.
 *
 * `title` is what a farmer reads. `hint` is the actionable next step, and is omitted where
 * there genuinely isn't one; a hint that says "please try again" on a permanent failure is
 * worse than silence.
 */
export type MessageTone = 'error' | 'warning' | 'info';

export interface MessageEntry {
  tone: MessageTone;
  bn: { title: string; hint?: string };
  en: { title: string; hint?: string };
}

export const MESSAGE_CATALOGUE: Record<string, MessageEntry> = {
  // ---- auth & access ----
  unauthorized: {
    tone: 'error',
    bn: { title: 'আবার লগইন করুন', hint: 'আপনার সেশনের সময় শেষ হয়েছে।' },
    en: { title: 'Please log in again', hint: 'Your session has expired.' },
  },
  forbidden: {
    tone: 'error',
    bn: { title: 'এই কাজ করার অনুমতি আপনার নেই' },
    en: { title: 'You do not have permission for this' },
  },
  phone_taken: {
    tone: 'error',
    bn: {
      title: 'এই নম্বরে ইতিমধ্যে অ্যাকাউন্ট আছে',
      hint: 'লগইন করুন, অথবা অন্য নম্বর ব্যবহার করুন।',
    },
    en: {
      title: 'An account already exists for this number',
      hint: 'Log in instead, or use a different number.',
    },
  },
  /**
   * Deliberately `info`, not `error`.
   *
   * Waiting for a reviewer is not a mistake the farmer made, and colouring it red tells them
   * they did something wrong at the exact moment they are least sure of themselves.
   */
  account_pending_approval: {
    tone: 'info',
    bn: {
      title: 'আপনার অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে',
      hint: 'অনুমোদন হলে ইমেইলে জানানো হবে। অবস্থা দেখতে "আবেদনের অবস্থা" পেজে যান।',
    },
    en: {
      title: 'Your account is waiting for approval',
      hint: 'We will email you when it is decided. You can also check your application status.',
    },
  },
  account_rejected: {
    tone: 'warning',
    bn: {
      title: 'আপনার আবেদন গ্রহণ করা হয়নি',
      hint: 'কারণ দেখে তথ্য ঠিক করে আবার জমা দিন।',
    },
    en: {
      title: 'Your application was not accepted',
      hint: 'Check the reason, correct it and submit again.',
    },
  },
  account_not_active: {
    tone: 'warning',
    bn: { title: 'আপনার অ্যাকাউন্ট এখনো চালু হয়নি' },
    en: { title: 'Your account is not open yet' },
  },
  slug_taken: {
    tone: 'error',
    bn: {
      title: 'এই শিরোনামের ঠিকানা ইতিমধ্যে ব্যবহৃত',
      hint: 'শিরোনামটি সামান্য বদলে দিন।',
    },
    en: {
      title: 'That title already has an address in use',
      hint: 'Change the title slightly.',
    },
  },
  code_required: {
    tone: 'info',
    bn: { title: 'ইমেইলে পাঠানো কোডটি দিন' },
    en: { title: 'Enter the code we emailed you' },
  },
  signup_expired: {
    tone: 'warning',
    bn: {
      title: 'নিবন্ধনের সময় শেষ হয়ে গেছে',
      hint: 'আবার শুরু করুন — বেশি সময় লাগবে না।',
    },
    en: { title: 'That signup has expired', hint: 'Please start again — it is quick.' },
  },
  registration_incomplete: {
    tone: 'warning',
    bn: { title: 'আগে ইমেইল যাচাই করুন' },
    en: { title: 'Verify your email address first' },
  },
  documents_not_needed: {
    tone: 'info',
    bn: { title: 'ক্রেতা অ্যাকাউন্টের জন্য কাগজপত্র লাগে না' },
    en: { title: 'A buyer account does not need documents' },
  },
  mail_send_failed: {
    tone: 'error',
    bn: {
      title: 'ইমেইল পাঠানো যায়নি',
      hint: 'ইমেইল ঠিকানা দেখে কিছুক্ষণ পরে আবার চেষ্টা করুন।',
    },
    en: {
      title: 'The email could not be sent',
      hint: 'Check the address and try again shortly.',
    },
  },

  // ---- bidding ----
  bid_too_low: {
    tone: 'warning',
    bn: {
      title: 'আপনার দর কম হয়েছে',
      hint: 'সর্বোচ্চ দরের চেয়ে বেশি দিন।',
    },
    en: { title: 'Your bid is too low', hint: 'Bid above the current highest.' },
  },
  // Not an error — the expected outcome of two people bidding at once. Tone matters:
  // showing this in red would make normal auction behaviour look broken.
  outbid_or_closed: {
    tone: 'warning',
    bn: {
      title: 'অন্য কেউ বেশি দর দিয়েছেন',
      hint: 'নতুন দর দেখে আবার চেষ্টা করুন।',
    },
    en: { title: 'Someone bid higher', hint: 'Check the new price and try again.' },
  },
  bidding_closed: {
    tone: 'warning',
    bn: { title: 'এই ফসলের বিডিং শেষ হয়ে গেছে' },
    en: { title: 'Bidding has closed for this lot' },
  },
  listing_closed: {
    tone: 'warning',
    bn: { title: 'এই ফসল আর বিক্রির জন্য নেই' },
    en: { title: 'This listing is no longer available' },
  },
  bid_withdrawn: {
    tone: 'error',
    bn: { title: 'এই দর প্রত্যাহার করা হয়েছে' },
    en: { title: 'That bid has been withdrawn' },
  },
  version_conflict: {
    tone: 'warning',
    bn: {
      title: 'তালিকাটি এর মধ্যে পরিবর্তিত হয়েছে',
      hint: 'সর্বশেষ দরগুলো দেখে আবার চেষ্টা করুন।',
    },
    en: {
      title: 'This listing changed while you were deciding',
      hint: 'Review the latest bids and try again.',
    },
  },
  has_bids: {
    tone: 'error',
    bn: {
      title: 'দর পড়ে যাওয়া ফসল বাতিল করা যায় না',
      hint: 'সময় শেষ হওয়া পর্যন্ত অপেক্ষা করুন।',
    },
    en: {
      title: 'A listing with bids cannot be cancelled',
      hint: 'Let the auction close instead.',
    },
  },
  not_open: {
    tone: 'error',
    bn: { title: 'শুধু চালু তালিকাই বাতিল করা যায়' },
    en: { title: 'Only an open listing can be cancelled' },
  },
  unknown_crop: {
    tone: 'error',
    bn: { title: 'এই ফসলটি তালিকায় নেই', hint: 'তালিকা থেকে একটি ফসল বেছে নিন।' },
    en: { title: 'That crop is not in the catalogue', hint: 'Pick one from the list.' },
  },

  // ---- payments & orders ----
  already_paid: {
    tone: 'info',
    bn: { title: 'এই অর্ডারের টাকা ইতিমধ্যে জমা হয়েছে' },
    en: { title: 'This order has already been paid' },
  },
  already_released: {
    tone: 'info',
    bn: { title: 'এই টাকা ইতিমধ্যে পরিশোধ হয়ে গেছে' },
    en: { title: 'This payment has already been settled' },
  },
  already_settled: {
    tone: 'info',
    bn: { title: 'এই লেনদেন ইতিমধ্যে সম্পন্ন' },
    en: { title: 'This transaction is already settled' },
  },
  order_not_payable: {
    tone: 'error',
    bn: { title: 'এই অর্ডারের জন্য এখন পেমেন্ট করা যাবে না' },
    en: { title: 'This order cannot be paid for right now' },
  },
  not_payable: {
    tone: 'error',
    bn: { title: 'এই পেমেন্ট আর সম্পন্ন করা যাবে না' },
    en: { title: 'This payment can no longer be completed' },
  },
  payment_window_expired: {
    tone: 'error',
    bn: {
      title: 'পেমেন্টের সময় শেষ হয়ে গেছে',
      hint: 'অর্ডারটি বাতিল হয়েছে এবং ফসলটি আবার তালিকায় যাবে।',
    },
    en: {
      title: 'The payment window has closed',
      hint: 'The order was cancelled and the lot will be relisted.',
    },
  },
  not_confirmed: {
    tone: 'error',
    bn: {
      title: 'ক্রেতা এখনো টাকা জমা দেননি',
      hint: 'টাকা জমা হওয়ার আগে পণ্য পাঠাবেন না।',
    },
    en: {
      title: 'The buyer has not paid into escrow yet',
      hint: 'Do not ship until the payment is held.',
    },
  },
  not_in_transit: {
    tone: 'error',
    bn: { title: 'বিক্রেতা এখনো পণ্য পাঠাননি' },
    en: { title: 'The seller has not marked this shipped yet' },
  },
  not_disputable: {
    tone: 'error',
    bn: { title: 'এই অর্ডারের বিষয়ে এখন অভিযোগ করা যাবে না' },
    en: { title: 'This order cannot be disputed right now' },
  },
  not_disputed: {
    tone: 'error',
    bn: { title: 'এই অর্ডারে কোনো অভিযোগ নেই' },
    en: { title: 'This order is not under dispute' },
  },
  not_refundable: {
    tone: 'error',
    bn: {
      title: 'এই পেমেন্ট স্বয়ংক্রিয়ভাবে ফেরত দেওয়া যাবে না',
      hint: 'সহায়তার জন্য যোগাযোগ করুন।',
    },
    en: {
      title: 'This payment cannot be refunded automatically',
      hint: 'Please contact support.',
    },
  },
  illegal_transition: {
    tone: 'error',
    bn: { title: 'এই অর্ডারে এই পরিবর্তন করা সম্ভব নয়' },
    en: { title: 'That change is not possible for this order' },
  },
  order_changed: {
    tone: 'warning',
    bn: { title: 'অর্ডারটি এর মধ্যে পরিবর্তিত হয়েছে', hint: 'আবার চেষ্টা করুন।' },
    en: { title: 'This order changed concurrently', hint: 'Please try again.' },
  },
  payments_unconfigured: {
    tone: 'error',
    bn: { title: 'পেমেন্ট সেবা এখন চালু নেই' },
    en: { title: 'Payments are not available right now' },
  },
  gateway_session_failed: {
    tone: 'error',
    bn: { title: 'পেমেন্ট শুরু করা যায়নি', hint: 'কিছুক্ষণ পরে আবার চেষ্টা করুন।' },
    en: { title: 'Could not start the payment', hint: 'Please try again shortly.' },
  },
  gateway_validation_failed: {
    tone: 'warning',
    bn: {
      title: 'পেমেন্টের তথ্য যাচাই করা যাচ্ছে না',
      hint: 'টাকা কাটা হলে তা নিরাপদ আছে — কিছুক্ষণ পরে অর্ডারটি দেখুন।',
    },
    en: {
      title: 'The payment could not be verified with the bank',
      hint: 'If you were charged, the money is safe — check the order again shortly.',
    },
  },
  gateway_refund_failed: {
    tone: 'error',
    bn: {
      title: 'ফেরত স্বয়ংক্রিয়ভাবে করা যায়নি',
      hint: 'আপনার টাকা আটকে আছে, হারায়নি। সহায়তার জন্য যোগাযোগ করুন।',
    },
    en: {
      title: 'The refund could not be completed automatically',
      hint: 'Your money is still held, not lost. Please contact support.',
    },
  },

  // ---- diagnosis ----
  no_image: {
    tone: 'error',
    bn: { title: 'একটি ছবি যোগ করুন' },
    en: { title: 'Please attach a photo' },
  },
  bad_image: {
    tone: 'error',
    bn: { title: 'ছবিটি পড়া যায়নি', hint: 'JPEG, PNG বা WebP ছবি দিন।' },
    en: { title: 'That file could not be read as an image', hint: 'Use JPEG, PNG or WebP.' },
  },
  bad_image_type: {
    tone: 'error',
    bn: { title: 'এই ধরনের ফাইল সমর্থিত নয়', hint: 'JPEG, PNG বা WebP ছবি দিন।' },
    en: { title: 'That file type is not supported', hint: 'Use JPEG, PNG or WebP.' },
  },
  model_unavailable: {
    tone: 'warning',
    bn: {
      title: 'রোগ নির্ণয় সেবা এখন বন্ধ আছে',
      hint: 'পরামর্শ বিভাগ ব্যবহার করতে পারেন।',
    },
    en: {
      title: 'Disease detection is unavailable',
      hint: 'You can use the advisory section instead.',
    },
  },
  inference_failed: {
    tone: 'error',
    bn: { title: 'ছবিটি পরীক্ষা করা যায়নি', hint: 'আরও স্পষ্ট ছবি দিয়ে চেষ্টা করুন।' },
    en: { title: 'The photo could not be analysed', hint: 'Try a clearer photo.' },
  },

  // ---- advisory ----
  ai_quota_exhausted: {
    tone: 'warning',
    bn: {
      title: 'পরামর্শ সেবা এখন ব্যস্ত',
      hint: 'কিছুক্ষণ পরে আবার চেষ্টা করুন।',
    },
    en: { title: 'The advisory service is busy', hint: 'Please try again shortly.' },
  },

  // ---- identity: phone / OTP ----
  otp_invalid: {
    tone: 'error',
    bn: { title: 'কোডটি সঠিক নয়', hint: 'আবার দেখে লিখুন।' },
    en: { title: 'That code is not correct', hint: 'Check the digits and try again.' },
  },
  otp_expired: {
    tone: 'warning',
    bn: { title: 'কোডের সময় শেষ', hint: 'নতুন কোড নিন।' },
    en: { title: 'That code has expired', hint: 'Request a new one.' },
  },
  otp_used: {
    tone: 'warning',
    bn: { title: 'এই কোড ইতিমধ্যে ব্যবহার হয়েছে' },
    en: { title: 'That code has already been used' },
  },
  email_required: {
    tone: 'error',
    bn: { title: 'নতুন ইমেইল ঠিকানা লিখুন' },
    en: { title: 'Enter the new email address' },
  },
  same_email: {
    tone: 'info',
    bn: { title: 'এটি ইতিমধ্যে আপনার ইমেইল ঠিকানা' },
    en: { title: 'That is already your email address' },
  },
  already_verified: {
    tone: 'info',
    bn: { title: 'আপনার ইমেইল ইতিমধ্যে যাচাই করা আছে' },
    en: { title: 'Your email address is already verified' },
  },
  email_unverified: {
    tone: 'warning',
    bn: {
      title: 'আগে ইমেইল ঠিকানা যাচাই করুন',
      hint: 'অ্যাকাউন্ট বিভাগে গিয়ে যাচাই করুন।',
    },
    en: {
      title: 'Verify your email address first',
      hint: 'Go to your account section to verify it.',
    },
  },

  // ---- identity: profile ----
  email_taken: {
    tone: 'error',
    bn: { title: 'এই ইমেইলে অন্য অ্যাকাউন্ট আছে' },
    en: { title: 'Another account already uses that email' },
  },
  password_unchanged: {
    tone: 'error',
    bn: { title: 'আগে ব্যবহার করা পাসওয়ার্ড দেওয়া যাবে না' },
    en: { title: 'Choose a password you have not used here' },
  },
  no_permitted_fields: {
    tone: 'error',
    bn: { title: 'এই তথ্যগুলো আপনার অ্যাকাউন্টে প্রযোজ্য নয়' },
    en: { title: 'None of those fields apply to your account' },
  },
  user_missing: {
    tone: 'error',
    bn: { title: 'অ্যাকাউন্ট পাওয়া যায়নি' },
    en: { title: 'Account not found' },
  },

  // ---- identity: KYC ----
  documents_missing: {
    tone: 'warning',
    bn: {
      title: 'সব কাগজপত্র এখনো দেওয়া হয়নি',
      hint: 'এনআইডির দুই পাশ ও নিজের ছবি দিতে হবে।',
    },
    en: {
      title: 'Some documents are still missing',
      hint: 'Both sides of your NID and a selfie are needed.',
    },
  },
  bad_document_kind: {
    tone: 'error',
    bn: { title: 'কাগজের ধরন সঠিক নয়' },
    en: { title: 'That document type is not recognised' },
  },
  kyc_locked: {
    tone: 'info',
    bn: {
      title: 'আপনার আবেদন যাচাই চলছে',
      hint: 'এই সময়ে কাগজপত্র বদলানো যাবে না।',
    },
    en: {
      title: 'Your application is under review',
      hint: 'Documents cannot be changed while it is being checked.',
    },
  },
  kyc_approved: {
    tone: 'info',
    bn: { title: 'আপনার পরিচয় ইতিমধ্যে যাচাই হয়েছে' },
    en: { title: 'Your identity is already verified' },
  },
  kyc_pending: {
    tone: 'info',
    bn: {
      title: 'যাচাই এখনো চলছে',
      hint: 'অনুমোদন পেলে ফসল তালিকায় দিতে পারবেন।',
    },
    en: {
      title: 'Your verification is still being reviewed',
      hint: 'You can list produce once it is approved.',
    },
  },
  kyc_rejected: {
    tone: 'error',
    bn: {
      title: 'আপনার যাচাই আবেদন গ্রহণ করা হয়নি',
      hint: 'কারণ দেখে আবার আবেদন করুন।',
    },
    en: {
      title: 'Your verification was not accepted',
      hint: 'Check the reason given and submit again.',
    },
  },
  kyc_not_started: {
    tone: 'warning',
    bn: {
      title: 'ফসল বিক্রি করতে আগে পরিচয় যাচাই করুন',
      hint: 'অ্যাকাউন্ট বিভাগে গিয়ে শুরু করুন।',
    },
    en: {
      title: 'Verify your identity before listing produce',
      hint: 'Start from your account section.',
    },
  },
  kyc_not_pending: {
    tone: 'warning',
    bn: { title: 'এই আবেদনের সিদ্ধান্ত ইতিমধ্যে হয়ে গেছে' },
    en: { title: 'That application has already been decided' },
  },
  reason_required: {
    tone: 'error',
    bn: { title: 'কারণ লিখুন', hint: 'আবেদনকারী যেন সংশোধন করতে পারেন।' },
    en: { title: 'A reason is required', hint: 'So the applicant can correct it.' },
  },
  storage_unconfigured: {
    tone: 'error',
    bn: { title: 'কাগজপত্র সংরক্ষণ সেবা এখন চালু নেই' },
    en: { title: 'Document storage is not available right now' },
  },

  // ---- buyer trust ----
  bid_over_ceiling: {
    tone: 'warning',
    bn: {
      title: 'এই দর আপনার বর্তমান সীমার চেয়ে বেশি',
      hint: 'অ্যাকাউন্ট যাচাই করলে সীমা বাড়বে।',
    },
    en: {
      title: 'This bid is above your current limit',
      hint: 'Verify your account to raise the limit.',
    },
  },
  account_suspended: {
    tone: 'error',
    bn: { title: 'আপনার অ্যাকাউন্ট স্থগিত আছে', hint: 'সহায়তার জন্য যোগাযোগ করুন।' },
    en: { title: 'Your account is suspended', hint: 'Please contact support.' },
  },

  // ---- generic / transport ----
  validation_failed: {
    tone: 'error',
    bn: { title: 'কিছু তথ্য ঠিক নেই', hint: 'চিহ্নিত ঘরগুলো দেখুন।' },
    en: { title: 'Some details are not valid', hint: 'Check the highlighted fields.' },
  },
  invalid_id: {
    tone: 'error',
    bn: { title: 'ভুল ঠিকানা' },
    en: { title: 'Invalid reference' },
  },
  not_found: {
    tone: 'error',
    bn: { title: 'যা খুঁজছেন তা পাওয়া যায়নি' },
    en: { title: 'That could not be found' },
  },
  route_not_found: {
    tone: 'error',
    bn: { title: 'যা খুঁজছেন তা পাওয়া যায়নি' },
    en: { title: 'That could not be found' },
  },
  duplicate_resource: {
    tone: 'error',
    bn: { title: 'এটি ইতিমধ্যে আছে' },
    en: { title: 'That already exists' },
  },
  illegal_key: {
    tone: 'error',
    bn: { title: 'অনুমোদিত নয় এমন তথ্য পাঠানো হয়েছে' },
    en: { title: 'The request contained a disallowed value' },
  },
  rate_limited: {
    tone: 'warning',
    bn: { title: 'একটু ধীরে চেষ্টা করুন', hint: 'কিছুক্ষণ অপেক্ষা করে আবার করুন।' },
    en: { title: 'Please slow down', hint: 'Wait a moment and try again.' },
  },
  internal_error: {
    tone: 'error',
    bn: { title: 'কিছু একটা সমস্যা হয়েছে', hint: 'আবার চেষ্টা করুন।' },
    en: { title: 'Something went wrong', hint: 'Please try again.' },
  },
  network_error: {
    tone: 'error',
    bn: {
      title: 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না',
      hint: 'সংযোগ দেখে আবার চেষ্টা করুন।',
    },
    en: { title: 'No internet connection', hint: 'Check your connection and try again.' },
  },
};

/**
 * Success messages, keyed by action rather than by error code.
 *
 * Alongside the failures on purpose: a farmer needs to be told the auction extended or the
 * money was released just as clearly as they need to be told something broke, and keeping
 * both in one catalogue stops the success wording from being an afterthought.
 */
export const SUCCESS_CATALOGUE: Record<string, MessageEntry> = {
  bid_placed: {
    tone: 'info',
    bn: { title: 'আপনার দর জমা হয়েছে' },
    en: { title: 'Your bid was placed' },
  },
  listing_created: {
    tone: 'info',
    bn: { title: 'ফসল তালিকায় যোগ হয়েছে' },
    en: { title: 'Your listing is live' },
  },
  listing_cancelled: {
    tone: 'info',
    bn: { title: 'তালিকা বাতিল হয়েছে' },
    en: { title: 'Listing cancelled' },
  },
  payment_held: {
    tone: 'info',
    bn: {
      title: 'টাকা নিরাপদে জমা রাখা হয়েছে',
      hint: 'পণ্য পাওয়ার পর নিশ্চিত করলেই বিক্রেতা টাকা পাবেন।',
    },
    en: {
      title: 'Your payment is held securely',
      hint: 'The seller is paid once you confirm the goods arrived.',
    },
  },
  order_shipped: {
    tone: 'info',
    bn: { title: 'পণ্য পাঠানো হয়েছে বলে চিহ্নিত হয়েছে' },
    en: { title: 'Marked as shipped' },
  },
  delivery_confirmed: {
    tone: 'info',
    bn: { title: 'ধন্যবাদ — বিক্রেতাকে টাকা পরিশোধ করা হয়েছে' },
    en: { title: 'Thank you — the seller has been paid' },
  },
  dispute_raised: {
    tone: 'warning',
    bn: {
      title: 'আপনার অভিযোগ জমা হয়েছে',
      hint: 'নিষ্পত্তি হওয়া পর্যন্ত টাকা আটকে থাকবে।',
    },
    en: {
      title: 'Your dispute has been submitted',
      hint: 'The payment stays held until it is resolved.',
    },
  },
  otp_sent: {
    tone: 'info',
    bn: { title: 'কোড পাঠানো হয়েছে' },
    en: { title: 'A code has been sent' },
  },
  email_verified: {
    tone: 'info',
    bn: { title: 'ইমেইল ঠিকানা যাচাই হয়েছে' },
    en: { title: 'Your email address is verified' },
  },
  email_changed: {
    tone: 'info',
    bn: { title: 'ইমেইল ঠিকানা পরিবর্তন হয়েছে' },
    en: { title: 'Your email address has been changed' },
  },
  registration_submitted: {
    tone: 'info',
    bn: {
      title: 'আপনার আবেদন জমা হয়েছে',
      hint: 'অনুমোদন হলে ইমেইলে জানানো হবে। তারপর লগইন করে ফসল বিক্রি করতে পারবেন।',
    },
    en: {
      title: 'Your application has been submitted',
      hint: 'We will email you once it is approved — then you can log in and sell produce.',
    },
  },
  registration_complete: {
    tone: 'info',
    bn: { title: 'আপনার অ্যাকাউন্ট তৈরি হয়েছে', hint: 'এখনই বাজারে দর দিতে পারেন।' },
    en: { title: 'Your account is ready', hint: 'You can start bidding right away.' },
  },
  password_reset: {
    tone: 'info',
    bn: { title: 'নতুন পাসওয়ার্ড সংরক্ষণ হয়েছে', hint: 'এখন লগইন করুন।' },
    en: { title: 'Your new password is saved', hint: 'You can log in now.' },
  },
  profile_updated: {
    tone: 'info',
    bn: { title: 'তথ্য সংরক্ষণ হয়েছে' },
    en: { title: 'Your details have been saved' },
  },
  password_changed: {
    tone: 'info',
    bn: { title: 'পাসওয়ার্ড পরিবর্তন হয়েছে', hint: 'আবার লগইন করুন।' },
    en: { title: 'Your password has been changed', hint: 'Please log in again.' },
  },
  document_uploaded: {
    tone: 'info',
    bn: { title: 'কাগজ যোগ হয়েছে' },
    en: { title: 'Document uploaded' },
  },
  kyc_submitted: {
    tone: 'info',
    bn: { title: 'আবেদন জমা হয়েছে', hint: 'যাচাই শেষ হলে আপনাকে জানানো হবে।' },
    en: {
      title: 'Your application has been submitted',
      hint: 'You will be notified once it is reviewed.',
    },
  },
  post_published: {
    tone: 'info',
    bn: { title: 'লেখা প্রকাশিত হয়েছে' },
    en: { title: 'Your post is live' },
  },
  post_saved: {
    tone: 'info',
    bn: { title: 'খসড়া সংরক্ষণ হয়েছে' },
    en: { title: 'Draft saved' },
  },
  post_deleted: {
    tone: 'info',
    bn: { title: 'লেখা মুছে ফেলা হয়েছে' },
    en: { title: 'Post deleted' },
  },
  message_sent: {
    tone: 'info',
    bn: { title: 'আপনার বার্তা পৌঁছেছে', hint: 'আমরা শীঘ্রই উত্তর দেব।' },
    en: { title: 'Your message has been received', hint: 'We will reply shortly.' },
  },
  review_recorded: {
    tone: 'info',
    bn: { title: 'সিদ্ধান্ত সংরক্ষণ হয়েছে' },
    en: { title: 'Decision recorded' },
  },
  refund_issued: {
    tone: 'info',
    bn: { title: 'টাকা ফেরত দেওয়া হয়েছে' },
    en: { title: 'Your refund has been issued' },
  },
};

export interface MessageBundle {
  locale: 'bn' | 'en';
  /** code -> { tone, title, hint? } for the requested locale. */
  errors: Record<string, { tone: MessageTone; title: string; hint?: string }>;
  success: Record<string, { tone: MessageTone; title: string; hint?: string }>;
  /** Bumped when wording changes, so a client can cache aggressively and still refresh. */
  version: string;
}

/** Wording revision. Bump on any copy change so caches invalidate. */
export const MESSAGE_VERSION = '3';

function flatten(
  catalogue: Record<string, MessageEntry>,
  locale: 'bn' | 'en',
): Record<string, { tone: MessageTone; title: string; hint?: string }> {
  return Object.fromEntries(
    Object.entries(catalogue).map(([code, entry]) => [
      code,
      { tone: entry.tone, title: entry[locale].title, hint: entry[locale].hint },
    ]),
  );
}

export function buildMessageBundle(locale: 'bn' | 'en'): MessageBundle {
  return {
    locale,
    errors: flatten(MESSAGE_CATALOGUE, locale),
    success: flatten(SUCCESS_CATALOGUE, locale),
    version: MESSAGE_VERSION,
  };
}
