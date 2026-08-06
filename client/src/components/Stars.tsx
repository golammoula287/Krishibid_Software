import { useTranslation } from 'react-i18next';

/**
 * A rating, shown or chosen.
 *
 * One component for both because they must agree exactly: a supplier looking at four filled stars
 * on their profile and a buyer who tapped the fourth star have to be looking at the same thing,
 * and two implementations of "how full is a star" drift.
 *
 * Drawn inline rather than with the icon set. A star here is a shape that is sometimes half
 * filled, which the shared `Icon` — one path, one stroke colour — cannot express.
 */
function Star({ fill }: { fill: number }) {
  const clipId = `star-clip-${Math.round(fill * 100)}`;

  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      <path
        d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z"
        className="fill-slate-200"
      />
      <path
        d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z"
        className="fill-amber-400"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}

export function Stars({ value, className = 'h-4 w-4' }: { value: number; className?: string }) {
  return (
    // One label for the row. Five separate "star" announcements would be five pieces of noise
    // where the useful information is the number.
    <span className="inline-flex gap-0.5" role="img" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={className}>
          {/* Clamped per star, so 3.4 fills three and a bit rather than rounding a decision away. */}
          <Star fill={Math.max(0, Math.min(1, value - (n - 1)))} />
        </span>
      ))}
    </span>
  );
}

export function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={t('review.nStars', { n })}
          aria-pressed={value === n}
          className="h-9 w-9 transition hover:scale-110"
        >
          <Star fill={n <= value ? 1 : 0} />
        </button>
      ))}
    </div>
  );
}
