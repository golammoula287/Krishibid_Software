import { MAX_LISTING_PHOTOS, createListingSchema } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { Listing, makeCategory, makeListing, makeUser } from '../test/factories.js';
import { createListing, getListing } from './listing.service.js';

const PHOTOS = [
  'https://res.cloudinary.com/demo/image/upload/lot-wide.jpg',
  'https://res.cloudinary.com/demo/image/upload/lot-grain.jpg',
  'https://res.cloudinary.com/demo/image/upload/lot-sacks.jpg',
];

const base = {
  categorySlug: 'crops',
  title: 'BR-28 rice',
  quantity: 200,
  unit: 'kg',
  qualityGrade: 'A',
  district: 'Rangpur',
  saleMode: 'fixed',
  pricePerUnitPoisha: 6_500,
  stock: 200,
} as const;

/**
 * Photographs of a lot.
 *
 * Produce is the one thing on this platform a buyer cannot inspect before committing money to
 * it, so the pictures are not decoration — they are most of what the decision is made on. Two
 * properties matter: the order the supplier chose survives, because the first one is the cover a
 * buyer sees in the market list, and listings that predate the field still show their picture.
 */
describe('listing photos', () => {
  it('keeps them in the order the supplier arranged, cover first', async () => {
    await makeCategory('crops');
    const supplier = await makeUser('farmer');

    const listing = await createListing(String(supplier._id), { ...base, photos: PHOTOS });

    expect(listing.photos).toEqual(PHOTOS);
    // Order is a decision, not an accident: sorting or de-duplicating here would silently
    // override which photograph the supplier chose to lead with.
    expect(listing.photos[0]).toBe(PHOTOS[0]);
  });

  it('gives an array even when there are none, so nothing downstream handles two shapes', async () => {
    await makeCategory('crops');
    const supplier = await makeUser('farmer');

    const listing = await createListing(String(supplier._id), base);

    expect(listing.photos).toEqual([]);
  });

  /**
   * Listings created before `photos` existed carried a single `imageUrl`. Dropping it would blank
   * the picture on every lot already on the platform, so the DTO folds it in as the cover.
   */
  it('shows a legacy single image as the cover photo', async () => {
    const supplier = await makeUser('farmer');
    const listing = await makeListing({ farmerId: supplier._id });
    await Listing.updateOne(
      { _id: listing._id },
      { $set: { imageUrl: 'https://example.test/old.jpg' }, $unset: { photos: '' } },
    );

    const dto = await getListing(String(listing._id));

    expect(dto.photos).toEqual(['https://example.test/old.jpg']);
  });

  it('prefers the array when a listing somehow has both', async () => {
    const supplier = await makeUser('farmer');
    const listing = await makeListing({ farmerId: supplier._id });
    await Listing.updateOne(
      { _id: listing._id },
      { $set: { imageUrl: 'https://example.test/old.jpg', photos: PHOTOS } },
    );

    const dto = await getListing(String(listing._id));

    expect(dto.photos).toEqual(PHOTOS);
  });

  it('refuses more than the cap', () => {
    const tooMany = Array.from(
      { length: MAX_LISTING_PHOTOS + 1 },
      (_, i) => `https://res.cloudinary.com/demo/image/upload/p${i}.jpg`,
    );

    const parsed = createListingSchema.safeParse({ ...base, photos: tooMany });

    expect(parsed.success).toBe(false);
  });

  /**
   * These strings go straight into an `<img src>` on a page every buyer sees, so what is checked
   * is the scheme rather than the shape. `z.string().url()` alone passes `javascript:alert(1)` —
   * it is a syntactically valid URL — which is how this test was written and immediately failed.
   */
  it.each([
    ['javascript:alert(1)', 'a script scheme'],
    ['http://example.test/lot.jpg', 'plain http, which a buyer page cannot load anyway'],
    ['/uploads/lot.jpg', 'a bare path'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'a data URL that is not an image'],
  ])('refuses %s (%s)', (photo) => {
    expect(createListingSchema.safeParse({ ...base, photos: [photo] }).success).toBe(false);
  });

  it.each([
    ['https://res.cloudinary.com/demo/image/upload/lot.jpg', 'what Cloudinary returns'],
    [
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      'the inline fallback, for running without a Cloudinary account',
    ],
  ])('accepts %s (%s)', (photo) => {
    expect(createListingSchema.safeParse({ ...base, photos: [photo] }).success).toBe(true);
  });
});
