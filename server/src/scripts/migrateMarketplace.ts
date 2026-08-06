/**
 * Migration for the marketplace becoming multi-category and two-shop.
 *
 *   npm run migrate:marketplace -- --dry
 *   npm run migrate:marketplace
 *
 * Every listing predating this change is a crop, weighed in kilograms, sold by auction — those
 * were the only options. So each one gets exactly that, and nothing has to be guessed:
 *
 *   cropSlug     -> categorySlug ('crops') and title (the crop name, humanised)
 *   quantityKg   -> quantity + unit ('kg')
 *   (implicit)   -> saleMode 'auction'
 *
 * `cropSlug` and `quantityKg` are left in place rather than deleted. They cost nothing, and a
 * migration that destroys the only copy of the original values is one you cannot check afterwards
 * or undo if the mapping turns out wrong.
 *
 * Idempotent: a listing that already has a `categorySlug` is skipped.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDb, disconnectDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { Category } from '../models/Category.js';
import { Listing } from '../models/Listing.js';
import { CATEGORIES } from './categories.js';

const DRY_RUN = process.argv.includes('--dry');

/** "sweet-potato" -> "Sweet potato". The crop slug was all the title information there was. */
function humanise(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Produce';
}

export async function migrateMarketplace(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no database handle');

  // ---- categories ----
  if (!DRY_RUN) {
    for (const category of CATEGORIES) {
      // Upsert rather than insert: re-running must not fail, and an operator who edited a name
      // by hand should not have it silently reverted to the seed on the next deploy... except
      // that names ARE the seed's job, so they are updated and only `active` is left alone.
      await Category.updateOne(
        { slug: category.slug },
        {
          $set: {
            names: category.names,
            units: category.units,
            perishable: category.perishable,
            order: category.order,
          },
          $setOnInsert: { active: true },
        },
        { upsert: true },
      );
    }
    logger.info({ count: CATEGORIES.length }, 'categories seeded');
  }

  // ---- listings ----
  const listings = db.collection('listings');
  const stale = await listings
    .find({ categorySlug: { $exists: false } })
    .project({ _id: 1, cropSlug: 1, quantityKg: 1 })
    .toArray();

  logger.info({ count: stale.length }, 'listings to migrate');

  if (stale.length > 0 && !DRY_RUN) {
    const operations = stale.map((listing) => ({
      updateOne: {
        filter: { _id: listing._id },
        update: {
          $set: {
            categorySlug: 'crops',
            title: humanise(String(listing.cropSlug ?? 'produce')),
            quantity: Number(listing.quantityKg ?? 0),
            unit: 'kg',
            // Everything that existed before this change was an auction; there was no other kind.
            saleMode: 'auction',
          },
        },
      },
    }));

    const result = await listings.bulkWrite(operations, { ordered: false });
    logger.info({ updated: result.modifiedCount }, 'listings migrated');
  } else if (DRY_RUN) {
    logger.info({ wouldUpdate: stale.length }, 'dry run — no changes written');
  }

  if (!DRY_RUN) {
    // Drops the old crop-shaped indexes and builds the ones the two shops query on.
    await Listing.syncIndexes();
    logger.info('listing indexes rebuilt');
  }

  const remaining = await listings.countDocuments({ categorySlug: { $exists: false } });
  logger.info({ remaining }, remaining === 0 ? 'migration complete' : 'listings still unmigrated');
}

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry!).href;
};

if (isEntryPoint()) {
  connectDb()
    .then(migrateMarketplace)
    .then(disconnectDb)
    .catch((err: unknown) => {
      logger.fatal({ err }, 'marketplace migration failed');
      process.exit(1);
    });
}
