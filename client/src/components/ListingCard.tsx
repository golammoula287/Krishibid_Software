import { displayPricePoisha, type ListingDto } from '@krishibid/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from './icons.js';
import { Stars } from './Stars.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * One listing, in either shop.
 *
 * Three pages were each rendering their own version of this and drifting apart. More importantly,
 * the two sale modes need genuinely different cards: an auction leads with a countdown and the
 * current bid, a fixed-price lot leads with a price and what is left in stock. A single card that
 * showed both would put a ticking clock next to a Buy button, which reads as pressure selling.
 */
export default function ListingCard({
  listing,
  categoryName,
}: {
  listing: ListingDto;
  /** Resolved by the caller, which already holds the category catalogue. */
  categoryName: string;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();

  const isAuction = listing.saleMode === 'auction';
  const remaining = isAuction && listing.bidClosesAt
    ? timeRemaining(listing.bidClosesAt, locale)
    : null;
  const price = displayPricePoisha(listing);

  return (
    <Link
      to={`/listing/${listing.id}`}
      className="card block transition hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        {/* The cover photo, small. Produce is the one thing here a buyer cannot inspect before
            committing money, so a picture of the actual lot earns its space on the card — but
            not more than a thumbnail's worth, or the list stops being scannable. */}
        {listing.photos[0] && (
          <img
            src={listing.photos[0]}
            alt=""
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-xl bg-slate-100 object-cover"
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-brand-900">{listing.title}</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {formatNumber(listing.quantity, locale)} {t(`units.${listing.unit}`)} ·{' '}
            {t('market.grade')} {listing.qualityGrade} · {listing.district}
          </p>
          {listing.photos.length > 1 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <Icon name="camera" className="h-3.5 w-3.5" />
              {listing.photos.length}
            </p>
          )}
        </div>

        {isAuction ? (
          remaining ? (
            <span
              className={`badge shrink-0 ${
                remaining.urgent ? 'bg-red-100 text-red-800' : 'bg-brand-100 text-brand-800'
              }`}
            >
              {remaining.text}
            </span>
          ) : (
            <span className="badge shrink-0 bg-slate-200 text-slate-600">{t('market.closed')}</span>
          )
        ) : (
          /* Stock, not a clock. What a buyer at a fixed price needs to know is whether there is
             enough left for them. */
          <span
            className={`badge shrink-0 ${
              (listing.stock ?? 0) > 0
                ? 'bg-brand-100 text-brand-800'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            {(listing.stock ?? 0) > 0
              ? t('shop.inStock', {
                  qty: formatNumber(listing.stock ?? 0, locale),
                  unit: t(`units.${listing.unit}`),
                })
              : t('shop.soldOut')}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-brand-50 pt-3">
        <div>
          <p className="text-xs text-slate-500">
            {isAuction
              ? listing.highestBid
                ? t('market.highestBid')
                : t('market.reserve')
              : t('shop.perUnit', { unit: t(`units.${listing.unit}`) })}
          </p>
          <p className="text-xl font-bold text-brand-800">{formatBdt(price, locale)}</p>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {isAuction ? (
            <>
              <Icon name="trending" className="h-4 w-4" />
              {(listing.bidCount ?? 0) > 0
                ? t('market.bidCount', { count: listing.bidCount })
                : t('market.noBids')}
            </>
          ) : (
            <>
              <Icon name="basket" className="h-4 w-4" />
              {t('shop.buyNow')}
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <Icon name="market" className="h-3.5 w-3.5" />
          {categoryName}
        </span>
        {/* Who is selling, in the buyer's terms. A grower and a reseller are different
            propositions and the card said nothing about which this was. */}
        {listing.supplierType && (
          <span className="flex items-center gap-1.5">
            <Icon name="account" className="h-3.5 w-3.5" />
            {t(`supplier.${listing.supplierType}`)}
          </span>
        )}
        {/* Their standing, where a buyer scanning twenty lots can act on it. Absent rather than
            zero when nobody has rated them yet — unrated is not the same as bad. */}
        {listing.supplierRating && (
          <span className="flex items-center gap-1 text-slate-500">
            <Stars value={listing.supplierRating.average} className="h-3 w-3" />
            {listing.supplierRating.average.toFixed(1)} ({listing.supplierRating.count})
          </span>
        )}
      </div>
    </Link>
  );
}
