import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Monorepo root .env, so api + scripts + tests all read one file.
loadDotenv({ path: path.resolve(process.cwd(), '../../.env') });
loadDotenv();

const boolish = z
  .string()
  .transform((v) => v.toLowerCase() === 'true' || v === '1')
  .pipe(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:5000'),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  AI_PROVIDER: z.enum(['gemini', 'claude', 'groq']).default('gemini'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  ANTHROPIC_API_KEY: z.string().default(''),
  CLAUDE_CHAT_MODEL: z.string().default('claude-opus-5'),
  GROQ_API_KEY: z.string().default(''),
  GROQ_CHAT_MODEL: z.string().default('llama-3.3-70b-versatile'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),

  SSLCZ_STORE_ID: z.string().default(''),
  SSLCZ_STORE_PASSWORD: z.string().default(''),
  SSLCZ_IS_LIVE: boolish.default('false'),
  PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(250),
  ESCROW_AUTO_RELEASE_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  PAYMENT_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(48),

  DISEASE_MODEL_PATH: z.string().default('./ml/artifacts/model-v1.onnx'),
  DISEASE_LABELS_PATH: z.string().default('./ml/artifacts/labels.json'),
  DISEASE_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),

  RAG_VECTOR_INDEX: z.string().default('kb_vector_index'),
  RAG_TEXT_INDEX: z.string().default('kb_text_index'),
  RAG_NUM_CANDIDATES: z.coerce.number().int().positive().default(150),
  RAG_RETRIEVE_LIMIT: z.coerce.number().int().positive().default(20),
  RAG_CONTEXT_LIMIT: z.coerce.number().int().positive().default(4),
  RAG_RRF_K: z.coerce.number().int().positive().default(60),
  RAG_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  RAG_ENABLE_RERANK: boolish.default('true'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_INFERENCE_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_CHAT_PER_HOUR: z.coerce.number().int().positive().default(20),

  DEMO_MODE: boolish.default('true'),
  DEMO_PASSWORD: z.string().default(''),
});

export type Env = z.infer<typeof envSchema> & { corsOrigins: string[] };

function buildEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Fail loudly at boot rather than at the first request that needs a
    // missing key — a half-configured server is worse than one that won't start.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  // Cross-field checks the per-field schema can't express.
  if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    throw new Error('AI_PROVIDER=gemini requires GEMINI_API_KEY');
  }
  if (env.AI_PROVIDER === 'claude' && !env.ANTHROPIC_API_KEY) {
    throw new Error('AI_PROVIDER=claude requires ANTHROPIC_API_KEY');
  }
  if (env.AI_PROVIDER === 'groq' && !env.GROQ_API_KEY) {
    throw new Error('AI_PROVIDER=groq requires GROQ_API_KEY');
  }
  // Neither Claude nor Groq offers embeddings, so retrieval needs Gemini regardless
  // of which provider generates. Caught at boot rather than on the first question.
  if (env.AI_PROVIDER !== 'gemini' && !env.GEMINI_API_KEY) {
    throw new Error(
      `AI_PROVIDER=${env.AI_PROVIDER} still requires GEMINI_API_KEY for embeddings`,
    );
  }
  if (env.NODE_ENV === 'production') {
    if (env.DEMO_MODE && !env.DEMO_PASSWORD) {
      throw new Error('DEMO_MODE=true in production requires DEMO_PASSWORD');
    }
    if (!env.API_PUBLIC_URL.startsWith('https://')) {
      throw new Error(
        'API_PUBLIC_URL must be https in production — SSLCOMMERZ will not post IPN callbacks to http',
      );
    }
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

let cached: Env | null = null;

/** Lazily validated so importing a module never throws on a missing key. */
export function env(): Env {
  cached ??= buildEnv();
  return cached;
}

/** Test-only: forces re-read of process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProd = (): boolean => env().NODE_ENV === 'production';
export const isTest = (): boolean => env().NODE_ENV === 'test';
