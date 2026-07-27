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

  for (const { collection, definition } of definitions) {
    try {
      await db.command({ createSearchIndexes: collection, indexes: [definition] });
      logger.info({ collection, index: definition.name }, 'search index created');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) {
        logger.info({ index: definition.name }, 'search index already exists — skipping');
      } else {
        logger.error({ err, index: definition.name }, 'failed to create search index');
      }
    }
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
