import { describe, expect, it } from 'vitest';
import { Listing, makeCategory, makeListing, makeUser } from '../test/factories.js';
import { listListings } from './listing.service.js';

/**
 * Searching the marketplace.
 *
 * These run against mongodb-memory-server, where Atlas `$search` does not exist — so every case
 * here exercises the direct-query path. That is the right thing to pin: it is the path that runs
 * on a fresh cluster, on any deployment where `create:indexes` has not been run, and whenever the
 * search index has drifted from the schema.
 *
 * Which is not hypothetical. The index was built against `cropSlug`, the schema renamed that
 * field to `title`, and the definition was never updated — so searching "Rice" returned nothing
 * while "Bogura" returned five, because `district` was still indexed. `$search` did not error; it
 * matched nothing, which looks exactly like "no results" from the outside.
 */
async function seedSearchable() {
  await makeCategory('crops');

  const karim = await makeUser('farmer', { name: 'Karim Uddin' });
  const shahida = await makeUser('farmer', { name: 'শাহিদা বেগম' });

  const a = await makeListing({ farmerId: karim._id });
  const b = await makeListing({ farmerId: shahida._id });

  await Listing.updateOne({ _id: a._id }, { $set: { title: 'BR-28 rice', district: 'Bogura' } });
  await Listing.updateOne(
    { _id: b._id },
    { $set: { title: 'Himsagar mango', district: 'Rajshahi', description: 'সরাসরি বাগান থেকে' } },
  );

  return { karim, shahida };
}

const titles = async (q: string): Promise<string[]> =>
  (await listListings({ q, limit: 20 } as never)).items.map((l) => l.title);

describe('marketplace search', () => {
  it('finds a listing by its product name', async () => {
    await seedSearchable();

    // The case that was broken: the index knew about districts and not titles.
    expect(await titles('rice')).toContain('BR-28 rice');
    expect(await titles('mango')).toContain('Himsagar mango');
  });

  it('finds a listing by its supplier’s name', async () => {
    await seedSearchable();

    // A supplier's name is on a user, not on the listing — no text index over the listing
    // collection can ever match it, however it is configured.
    expect(await titles('Karim')).toEqual(['BR-28 rice']);
  });

  it('finds a listing by a Bangla supplier name', async () => {
    await seedSearchable();

    expect(await titles('শাহিদা')).toEqual(['Himsagar mango']);
  });

  it('finds listings by the category’s name in either language', async () => {
    await seedSearchable();

    // `makeCategory('crops')` is named "ফসল" / "Crops". Neither string is on a listing — the
    // listing carries the slug — so matching either means the category was resolved first.
    expect((await titles('Crops')).length).toBe(2);
    expect((await titles('ফসল')).length).toBe(2);
  });

  it('still matches district and description', async () => {
    await seedSearchable();

    expect(await titles('Bogura')).toEqual(['BR-28 rice']);
    expect(await titles('বাগান')).toEqual(['Himsagar mango']);
  });

  it('returns nothing for a term that matches nothing, rather than everything', async () => {
    await seedSearchable();

    // The fallback ORs several branches together; an empty branch list would make it match all.
    expect(await titles('zzzznotathing')).toEqual([]);
  });

  it('treats a regex metacharacter as text, not as a pattern', async () => {
    await seedSearchable();

    // An unescaped search box is a regex injection, and `(a+)+$` typed into it is a denial of
    // service somebody can reach with a keyboard.
    expect(await titles('.*')).toEqual([]);
    await expect(titles('(a+)+$')).resolves.toEqual([]);
  });

  it('does not leak listings that the filter excludes', async () => {
    const { karim } = await seedSearchable();
    const sold = await makeListing({ farmerId: karim._id, status: 'sold' });
    await Listing.updateOne({ _id: sold._id }, { $set: { title: 'rice already sold' } });

    // Search widens what is looked at; it must not widen what is allowed through.
    expect(await titles('rice')).not.toContain('rice already sold');
  });
});
