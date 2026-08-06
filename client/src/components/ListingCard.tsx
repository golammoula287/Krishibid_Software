import { displayPricePoisha, type ListingDto } from '@krishibid/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from './icons.js';
import { Stars } from './Stars.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * A fallback picture, chosen from the category.
 *
 * A grid where some cards have a photograph and others have a grey rectangle looks broken rather
 * than sparse, and it is the older listings — the ones from before photos existed — that would
 * carry the holes. A category-appropriate image is honest enough: it is obviously a stock shot of
 * vegetables rather than a photograph of this particular lot, and the card says which category it
 * is right underneath.
 */
const CATEGORY_IMAGE: Record<string, string> = {
  crops: '/img/produce-spread.webp',
  vegetables: '/img/cat-vegetables.webp',
  fruit: '/img/cat-fruit.webp',
  fish: '/img/cat-mixed.webp',
  meat: '/img/cat-mixed.webp',
  dairy: '/img/cat-dairy.webp',
  oil: '/img/cat-mixed.webp',
  spices: '/img/cat-mixed.webp',
  pulses: '/img/cat-mixed.webp',
  seeds: '/img/plant-1.webp',
  fertiliser: '/img/plant-2.webp',
  equipment: '/img/field-green.webp',
  other: '/img/cat-mixed.webp',
};

export function listingImage(listing: Pick<ListingDto, 'photos' | 'categorySlug'>): string {
  return listing.photos[0] ?? CATEGORY_IMAGE[listing.categorySlug] ?? '/img/cat-mixed.webp';
}

/**
 * One listing, in either shop.
 *
 * Three pages were each rendering their own version of this and drifting apart. More importantly,
 * the two sale modes need genuinely different cards: an auction leads with a countdown and the
 * current bid, a fixed-price lot leads with a price and what is left in stock. A single card that
 * showed both would put a ticking clock next to a Buy button, which reads as pressure selling.
 *
 * The image is a fixed 4:3 frame with `object-cover`, so a portrait phone photo and a wide stock
 * shot occupy exactly the same space. Letting each card size itself to its picture produces a grid
 * with ragged rows, which is the single thing that makes a marketplace look amateur.
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
  const remaining =
    isAuction && listing.bidClosesAt ? timeRemaining(listing.bidClosesAt, locale) : null;
  const price = displayPricePoisha(listing);
  const stock = listing.stock ?? 0;
  const soldOut = !isAuction && stock <= 0;

  return (
    <Link
      to={`/listing/${listing.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-50">
        <img
          src={listingImage(listing)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />

        {/* Top-left: which shop this is. The single most important thing to know before reading
            the price, because it changes what the price means. */}
        <span
          className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
            isAuction ? 'bg-amber-400 text-amber-950' : 'bg-brand-600 text-white'
          }`}
        >
          <Icon name={isAuction ? 'trending' : 'basket'} className="h-3 w-3" />
          {t(`market.shop.${listing.saleMode}`)}
        </span>

        {/* Top-right: the deadline, or that there is none left to buy. */}
        {isAuction && remaining && (
          <span
            className={`absolute right-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
              remaining.urgent ? 'bg-red-500 text-white' : 'bg-white/95 text-slate-700'
            }`}
          >
            {remaining.text}
          </span>
        )}

        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-bold uppercase tracking-wide text-slate-600">
            {t('shop.soldOut')}
          </span>
        )}

        {listing.photos.length > 1 && (
          <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
            <Icon name="camera" className="h-3 w-3" />
            {listing.photos.length}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
          {categoryName}
        </p>
        <h3 className="mt-0.5 truncate font-bold text-slate-900 group-hover:text-brand-800">
          {listing.title}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {formatNumber(listing.quantity, locale)} {t(`units.${listing.unit}`)} ·{' '}
          {t('market.grade')} {listing.qualityGrade} · {listing.district}
        </p>

        {/* Pushed to the bottom so every card in a row lines its price up, whatever the title
            length did to the block above it. */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div>
            <p className="text-[11px] text-slate-500">
              {isAuction
                ? listing.highestBid
                  ? t('market.highestBid')
                  : t('market.reserve')
                : t('shop.perUnit', { unit: t(`units.${listing.unit}`) })}
            </p>
            <p className="text-xl font-bold text-brand-700">{formatBdt(price, locale)}</p>
          </div>

          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
            {isAuction ? (
              <>
                <Icon name="trending" className="h-3.5 w-3.5" />
                {(listing.bidCount ?? 0) > 0
                  ? t('market.bidCount', { count: listing.bidCount })
                  : t('market.noBids')}
              </>
            ) : (
              !soldOut && (
                <>
                  <Icon name="basket" className="h-3.5 w-3.5" />
                  {t('shop.inStock', {
                    qty: formatNumber(stock, locale),
                    unit: t(`units.${listing.unit}`),
                  })}
                </>
              )
            )}
          </span>
        </div>

        {/* The supplier, and their standing if anyone has rated them. Last because it qualifies
            the offer above rather than being the offer. */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="account" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {listing.supplierType ? t(`supplier.${listing.supplierType}`) : listing.farmerName}
            </span>
          </span>
          {/* Absent rather than zero when nobody has rated them — unrated is not the same as bad. */}
          {listing.supplierRating && (
            <span className="flex shrink-0 items-center gap-1">
              <Stars value={listing.supplierRating.average} className="h-3 w-3" />
              {listing.supplierRating.average.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
