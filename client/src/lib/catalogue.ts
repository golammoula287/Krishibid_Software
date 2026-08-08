import type { CategoryDto, ListingDto, Page, SaleMode } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { categoryImage } from './categoryImage.js';
import { currentLocale } from './i18n.js';

/**
 * The category catalogue, and the two shop feeds.
 *
 * Categories are reference data served by the API rather than an enum in the bundle, so adding
 * one is a seed run and not a redeploy. Cached for an hour: it changes about never, and this is
 * on the public path where every avoidable request costs a visitor money.
 */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryDto[]>('/categories'),
    staleTime: 60 * 60_000,
  });
}

/** Resolves a slug to its localised name, falling back to the slug rather than to nothing. */
export function useCategoryName(): (slug: string) => string {
  const categories = useCategories();
  const locale = currentLocale();
  return (slug: string) => categories.data?.find((c) => c.slug === slug)?.names[locale] ?? slug;
}

/** Resolves a slug to its image URL, checking custom category image before falling back. */
export function useCategoryImage(): (slug: string) => string {
  const categories = useCategories();
  return (slug: string) => {
    const found = categories.data?.find((c) => c.slug === slug);
    return categoryImage(found || slug);
  };
}

export interface ShopFilters {
  categorySlug?: string;
  district?: string;
  q?: string;
  /** 1-based. When set, the API returns a total and a page count instead of a cursor. */
  page?: number;
  limit?: number;
}

/**
 * One hook for both shops, differing only by `saleMode`.
 *
 * The two feeds are the same query against the same collection; what makes them different shops
 * is what is shown, not how it is fetched. Duplicating the hook would mean two places to fix the
 * next time a filter is added.
 */
export function useShopListings(saleMode: SaleMode, filters: ShopFilters) {
  const params = new URLSearchParams({ saleMode });
  if (filters.categorySlug) params.set('categorySlug', filters.categorySlug);
  if (filters.district) params.set('district', filters.district);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));

  return useQuery({
    queryKey: ['listings', saleMode, filters],
    queryFn: () => api.get<Page<ListingDto>>(`/marketplace/listings?${params.toString()}`),
    /**
     * The previous page stays on screen while the next one loads.
     *
     * Without this, clicking page 2 empties the grid to a skeleton and jumps the scroll position,
     * which on a slow connection feels like the page broke rather than like it is working.
     */
    placeholderData: (previous) => previous,
  });
}
