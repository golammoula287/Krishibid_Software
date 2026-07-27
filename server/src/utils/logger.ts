import pino, { type Logger as PinoLogger } from 'pino';
import { env } from '../config/env.js';

/**
 * `redact` is not optional politeness: SSLCOMMERZ IPN bodies carry card metadata and
 * signature material, and auth bodies carry passwords. Anything that could hold a
 * secret is scrubbed at the logger, so a future `log.info(req.body)` cannot leak it.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
  'store_passwd',
  '*.store_passwd',
  'verify_sign',
  '*.verify_sign',
  'card_no',
  '*.card_no',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
];

let instance: PinoLogger | null = null;

/**
 * Built lazily on first use rather than at module load.
 *
 * Importing this module must not trigger environment validation. `logger` is
 * imported by nearly every file, so eager validation would mean that merely
 * importing a pure function — a money helper, say — requires a fully configured
 * MONGODB_URI. That makes unit tests and one-off scripts brittle for no benefit.
 */
function build(): PinoLogger {
  const nodeEnv = env().NODE_ENV;

  return pino({
    level: nodeEnv === 'test' ? 'silent' : nodeEnv === 'production' ? 'info' : 'debug',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(nodeEnv === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

/**
 * Proxy so `logger.info(...)` still reads naturally at call sites while deferring
 * construction until the first actual log call.
 */
export const logger: PinoLogger = new Proxy({} as PinoLogger, {
  get(_target, property, receiver) {
    instance ??= build();
    const value = Reflect.get(instance, property, receiver) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});

export type Logger = PinoLogger;
