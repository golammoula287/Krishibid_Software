import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from './icons.js';

export interface Slide {
  image: string;
  /** i18n keys, resolved here so the caller stays a list of data. */
  kicker: string;
  title: string;
  body: string;
  cta: { to: string; label: string };
}

const INTERVAL_MS = 6000;

/**
 * The banner at the top of the marketplace.
 *
 * Auto-advancing, which is a thing worth being careful about: a carousel that moves while
 * somebody is reading it is one of the more user-hostile patterns on the web. So it stops on
 * hover and on focus, it stops permanently the moment anyone touches a control — if you have
 * said which slide you want, we do not then override you — and it does not move at all for a
 * user who has asked their system for reduced motion.
 *
 * Slides are all mounted and cross-faded rather than swapped, so the images are decoded once and
 * a transition never shows a blank frame on a slow connection.
 */
export default function BannerSlider({ slides }: { slides: Slide[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Set once the user drives it. Auto-advance never resumes after this. */
  const [taken, setTaken] = useState(false);

  const touchStartX = useRef<number | null>(null);

  const go = useCallback(
    (next: number) => setIndex(((next % slides.length) + slides.length) % slides.length),
    [slides.length],
  );

  const take = (next: number): void => {
    setTaken(true);
    go(next);
  };

  useEffect(() => {
    if (taken || paused || slides.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => go(index + 1), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [index, paused, taken, slides.length, go]);

  if (slides.length === 0) return null;

  return (
    <section
      className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // Swipe, because this is a phone-first audience and arrows are a mouse idea.
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null) return;
        if (Math.abs(end - start) > 50) take(index + (end < start ? 1 : -1));
        touchStartX.current = null;
      }}
      aria-roledescription="carousel"
      aria-label={t('market.bannerLabel')}
    >
      {/**
       * Shorter on a phone, and every line inside it steps down too.
       *
       * At 360px the desktop sizes put a five-line headline, a kicker, two lines of body and a
       * button into 352px of height — the button fell off the bottom. Sizing the type to the
       * viewport is the fix; clipping is what happens when you do not.
       */}
      <div className="relative h-[19rem] sm:h-[24rem] lg:h-[26rem]">
        {slides.map((slide, i) => (
          <div
            key={slide.image}
            className={`absolute inset-0 transition-opacity duration-700 ${
              i === index ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={i !== index}
          >
            <img
              src={slide.image}
              alt=""
              className="h-full w-full object-cover"
              // The first slide is the largest paint on the page; the rest can wait.
              fetchPriority={i === 0 ? 'high' : 'low'}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
            {/* Left-weighted, so the text has contrast and the produce is not dimmed. */}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-transparent" />

            <div className="absolute inset-0 flex flex-col justify-center px-5 sm:px-12">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-300 sm:text-[11px] sm:tracking-[0.25em]">
                {t(slide.kicker)}
              </p>
              <h2 className="mt-2 max-w-lg text-2xl font-bold leading-tight text-white sm:mt-3 sm:text-4xl lg:text-5xl">
                {t(slide.title)}
              </h2>
              {/* Hidden on the smallest screens rather than shrunk to nothing: at 360px the
                  headline and the button are what matter, and a third block of prose between
                  them is what pushed the button off the slide. */}
              <p className="mt-2 hidden max-w-md text-sm leading-relaxed text-slate-200 xs:block sm:mt-3 sm:text-base">
                {t(slide.body)}
              </p>
              <Link
                to={slide.cta.to}
                tabIndex={i === index ? 0 : -1}
                className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-500 sm:mt-6 sm:px-6 sm:py-3"
              >
                {t(slide.cta.label)}
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <>
          {[-1, 1].map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => take(index + direction)}
              aria-label={t(direction < 0 ? 'common.previous' : 'common.next')}
              className={`absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-800 shadow-md transition hover:bg-white sm:flex ${
                direction < 0 ? 'left-4' : 'right-4'
              }`}
            >
              <Icon
                name="arrowRight"
                className={`h-5 w-5 ${direction < 0 ? 'rotate-180' : ''}`}
              />
            </button>
          ))}

          <div className="absolute bottom-4 left-5 flex gap-2 sm:bottom-5 sm:left-12">
            {slides.map((slide, i) => (
              <button
                key={slide.image}
                type="button"
                onClick={() => take(i)}
                aria-label={t('market.goToSlide', { n: i + 1 })}
                aria-current={i === index}
                // A wider bar for the active one: a row of identical dots makes you count to
                // work out where you are.
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-8 bg-white' : 'w-3 bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
