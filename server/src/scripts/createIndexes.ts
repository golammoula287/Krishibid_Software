/**
 * Creates the Atlas Search indexes.
 *
 *   npm run create:indexes
 *
 * IMPORTANT — an Atlas M0 (free) cluster permits a MAXIMUM OF 3 search indexes
 * across both `search` and `vectorSearch` types. All three are allocated:
 *
 *   1. kb_vector_index      vectorSearch on kbChunks.embedding   (RAG dense leg)
 *   2. kb_text_index        search/BM25 on kbChunks.text         (RAG lexical leg)
 *   3. listing_text_index   search/BM25 on listings              (marketplace search)
 *
 * There are no slots left. Adding a fourth requires upgrading to Flex (10) or
 * folding the new need into an existing index. See docs/adr/ADR-003.
 *
 * These commands require Atlas; they will fail against a local mongod, which is
 * expected and is why the retrieval code degrades gracefully.
 */
import { env } from '../config/env.js';
import { connectDb, disconnectDb, mongoose } from '../utils/db.js';
import { logger } from '../utils/logger.js';

async function createIndexes(): Promise<void> {
  await connectDb();
  const e = env();
  const db = mongoose.connection.db;
  if (!db) throw new Error('no database handle');

  const definitions = [
    {
      collection: 'kbchunks',
      definition: {
        name: e.RAG_VECTOR_INDEX,
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              // Must equal EMBEDDING_DIMENSIONS. A mismatch makes $vectorSearch
              // return zero results silently rather than erroring.
              numDimensions: e.EMBEDDING_DIMENSIONS,
              similarity: 'cosine',
            },
            // Declared as filter fields so narrowing happens inside the ANN
            // search rather than pruning results after the fact.
            { type: 'filter', path: 'cropTags' },
            { type: 'filter', path: 'locale' },
          ],
        },
      },
    },
    {
      collection: 'kbchunks',
      definition: {
        name: e.RAG_TEXT_INDEX,
        type: 'search',
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              text: { type: 'string', analyzer: 'lucene.standard' },
              locale: { type: 'token' },
              cropTags: { type: 'token' },
            },
          },
        },
      },
    },
    {
      collection: 'listings',
      definition: {
        name: 'listing_text_index',
        type: 'search',
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              /**
               * `title` is the field people actually search, and it was missing.
               *
               * The listing schema renamed `cropSlug` to `title` when the marketplace stopped
               * assuming everything was a crop, and this definition was not updated with it. The
               * failure was silent in the worst way: `$search` did not error, it matched nothing
               * — so searching "Rice" returned zero results while "Bogura" returned five,
               * because `district` was still indexed and `title` was not.
               */
              title: { type: 'string', analyzer: 'lucene.standard' },
              categorySlug: { type: 'string', analyzer: 'lucene.standard' },
              /** Kept so listings written before the rename are still findable. */
              cropSlug: { type: 'string', analyzer: 'lucene.standard' },
              description: { type: 'string', analyzer: 'lucene.standard' },
              district: { type: 'string', analyzer: 'lucene.standard' },
              status: { type: 'token' },
            },
          },
        },
      },
    },
  ];

  /**
   * Atlas refuses to create a search index on a collection that does not exist yet,
   * failing with NamespaceNotFound. On a fresh cluster that makes this script
   * order-dependent — it would only work after something had already written data.
   *
   * Creating the empty collections first makes it runnable at any point, which is what
   * the documented setup sequence assumes.
   */
  const existing = new Set((await db.collections()).map((c) => c.collectionName));
  const needed = [...new Set(definitions.map((d) => d.collection))];

  for (const name of needed) {
    if (existing.has(name)) continue;
    try {
      await db.createCollection(name);
      logger.info({ collection: name }, 'created empty collection for indexing');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A concurrent run may have created it between the check and the call.
      if (!/already exists/i.test(message)) throw err;
    }
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const { collection, definition } of definitions) {
    try {
      await db.command({ createSearchIndexes: collection, indexes: [definition] });
      logger.info({ collection, index: definition.name }, 'search index created');
      created++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists|IndexAlreadyExists|Duplicate Index/i.test(message)) {
        logger.info({ index: definition.name }, 'search index already exists — skipping');
        skipped++;
      } else {
        // M0 permits a maximum of 3 search indexes; exceeding it fails here rather
        // than silently producing a retrieval path that returns nothing.
        logger.error(
          { index: definition.name, collection, reason: message.slice(0, 300) },
          'failed to create search index',
        );
        failed++;
      }
    }
  }

  logger.info({ created, skipped, failed, total: definitions.length }, 'index run complete');

  if (failed > 0) {
    throw new Error(
      `${failed} of ${definitions.length} search indexes failed — retrieval will not work until they exist`,
    );
  }

  logger.info(
    'index creation requested — Atlas builds them asynchronously, so allow a minute before querying',
  );
  await disconnectDb();
}

createIndexes().catch((err) => {
  logger.fatal({ err }, 'createIndexes failed');
  process.exit(1);
});
