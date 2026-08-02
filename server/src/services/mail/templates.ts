import { env } from '../../config/env.js';
import type { MailMessage } from './index.js';

/**
 * Email bodies, server-side and bilingual.
 *
 * Server-side for the same reason the message catalogue is: wording — Bangla especially, which will
 * need iteration with real users — changes as a deployed data change rather than a client rebuild.
 *
 * Every template ships plain text. HTML is optional and additive; text-only mail is far less likely
 * to be filed as spam, and an OTP that lands in spam is a user who cannot sign up.
 */
export type TemplateName =
  | 'otp_signup'
  | 'otp_reset'
  | 'otp_status'
  | 'welcome_buyer'
  | 'application_received'
  | 'admin_new_application'
  | 'kyc_approved'
  | 'kyc_rejected';

type Locale = 'bn' | 'en';

interface TemplateVars {
  name?: string;
  code?: string;
  minutes?: number;
  reason?: string;
  district?: string;
  bidLimit?: string;
}

const webUrl = (): string => env().WEB_PUBLIC_URL.replace(/\/+$/, '');

/**
 * Bilingual by concatenation rather than by picking one.
 *
 * A farmer's stored locale is a preference, not a guarantee they read that language comfortably —
 * and an email is read once, out of context, possibly by a family member helping. Both languages in
 * one message costs a few lines and removes the chance of sending someone something unreadable.
 */
function bilingual(bn: string, en: string): string {
  return `${bn}\n\n---\n\n${en}`;
}

export function renderTemplate(
  name: TemplateName,
  vars: TemplateVars,
  _locale: Locale = 'bn',
): Omit<MailMessage, 'to'> {
  const app = 'KrishiBid';
  const who = vars.name ?? '';
  const code = vars.code ?? '';
  const mins = vars.minutes ?? 10;

  switch (name) {
    case 'otp_signup':
      return {
        subject: `${app} — আপনার কোড / your code: ${code}`,
        text: bilingual(
          `আপনার ${app} যাচাই কোড: ${code}\n\nএই কোডটি ${mins} মিনিট পর্যন্ত কাজ করবে।\nকোডটি কারও সঙ্গে শেয়ার করবেন না।\n\nআপনি যদি অ্যাকাউন্ট তৈরি না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন।`,
          `Your ${app} verification code is: ${code}\n\nIt is valid for ${mins} minutes.\nDo not share this code with anyone.\n\nIf you did not try to create an account, you can ignore this email.`,
        ),
      };

    case 'otp_reset':
      return {
        subject: `${app} — পাসওয়ার্ড রিসেট কোড / password reset code: ${code}`,
        text: bilingual(
          `আপনার পাসওয়ার্ড পরিবর্তনের কোড: ${code}\n\nএই কোডটি ${mins} মিনিট পর্যন্ত কাজ করবে।\n\nআপনি যদি পাসওয়ার্ড পরিবর্তনের অনুরোধ না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন — আপনার অ্যাকাউন্ট অপরিবর্তিত থাকবে।`,
          `Your password reset code is: ${code}\n\nIt is valid for ${mins} minutes.\n\nIf you did not request a password reset, ignore this email — your account is unchanged.`,
        ),
      };

    case 'otp_status':
      return {
        subject: `${app} — আবেদনের অবস্থা দেখার কোড / status code: ${code}`,
        text: bilingual(
          `আপনার আবেদনের অবস্থা দেখার কোড: ${code}\n\n${webUrl()}/signup/status পেজে এই কোডটি দিন।\nকোডটি ${mins} মিনিট পর্যন্ত কাজ করবে।`,
          `Your code to check your application status is: ${code}\n\nEnter it at ${webUrl()}/signup/status\nIt is valid for ${mins} minutes.`,
        ),
      };

    case 'welcome_buyer':
      return {
        subject: `${app}-এ স্বাগতম / Welcome to ${app}`,
        text: bilingual(
          `${who}, ${app}-এ স্বাগতম।\n\nআপনি এখনই বাজার দেখে ফসলের উপর দর দিতে পারেন।\n\nবর্তমান দরের সীমা: ${vars.bidLimit ?? '৳২৫,০০০'}\nব্যবসার তথ্য ও পরিচয় যাচাই করলে এই সীমা বাড়বে — অ্যাকাউন্ট বিভাগ দেখুন।\n\n${webUrl()}`,
          `Welcome to ${app}, ${who}.\n\nYou can browse the market and bid on produce right away.\n\nYour current bid limit is ${vars.bidLimit ?? 'BDT 25,000'}.\nAdding your business details and verifying your identity raises it — see your account section.\n\n${webUrl()}`,
        ),
      };

    case 'application_received':
      return {
        subject: `${app} — আপনার আবেদন জমা হয়েছে / application received`,
        text: bilingual(
          `${who}, আপনার কৃষক অ্যাকাউন্টের আবেদন আমরা পেয়েছি।\n\nআমাদের একজন কর্মী আপনার কাগজপত্র দেখে সিদ্ধান্ত নেবেন। অনুমোদন পাওয়ার পরেই আপনি লগইন করে ফসল বিক্রি করতে পারবেন।\n\nঅবস্থা দেখতে: ${webUrl()}/signup/status\n\nএই ইমেইলটি রেখে দিন — এতে আবেদনের প্রমাণ ও লিংক রয়েছে।`,
          `${who}, we have received your farmer account application.\n\nA member of our team will review your documents and decide. You will be able to log in and sell produce once it is approved.\n\nCheck your status: ${webUrl()}/signup/status\n\nKeep this email — it is your record of the application and carries the status link.`,
        ),
      };

    case 'admin_new_application':
      // Admin-facing, so English only — the reviewer is the operator, not a farmer.
      return {
        subject: `[${app}] New farmer application — ${who}`,
        text: `A new farmer account is awaiting review.\n\nName:     ${who}\nDistrict: ${vars.district ?? '—'}\n\nReview queue: ${webUrl()}/admin/review\n\nThe applicant cannot log in or list produce until this is approved.`,
      };

    case 'kyc_approved':
      return {
        subject: `${app} — আপনার অ্যাকাউন্ট অনুমোদিত / your account is approved`,
        text: bilingual(
          `${who}, অভিনন্দন — আপনার অ্যাকাউন্ট অনুমোদিত হয়েছে।\n\nএখন লগইন করে ফসল বিক্রির জন্য তালিকায় দিতে পারবেন।\n\n${webUrl()}`,
          `${who}, congratulations — your account has been approved.\n\nYou can now log in and list produce for sale.\n\n${webUrl()}`,
        ),
      };

    case 'kyc_rejected':
      return {
        subject: `${app} — আবেদন সম্পর্কে / about your application`,
        text: bilingual(
          `${who}, দুঃখিত — এবার আপনার আবেদন গ্রহণ করা যায়নি।\n\nকারণ: ${vars.reason ?? '—'}\n\nউপরের বিষয়টি ঠিক করে আপনি আবার আবেদন করতে পারেন। লগইন করে অ্যাকাউন্ট বিভাগে যান।\n\n${webUrl()}/login`,
          `${who}, unfortunately your application was not accepted this time.\n\nReason: ${vars.reason ?? '—'}\n\nYou can fix this and apply again — log in and go to your account section.\n\n${webUrl()}/login`,
        ),
      };
  }
}
