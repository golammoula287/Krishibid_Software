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
export const MESSAGE_VERSION = '1';

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
