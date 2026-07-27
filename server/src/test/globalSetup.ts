import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

let replSet: MongoMemoryReplSet | undefined;

/**
 * Starts ONE in-memory MongoDB for the entire run.
 *
 * A **replica set**, not a standalone `mongod`: the accept-bid and payment paths use
 * multi-document transactions, which a standalone server rejects outright. Testing
 * against a standalone would leave the transaction code — the code most worth
 * testing — never actually exercised.
 *
 * This lives in `globalSetup` rather than `setupFiles` because setupFiles are
 * re-evaluated for every test file. Spinning up a replica set per file cost ~40s
 * each and dominated the suite runtime.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();
  // Workers run in separate processes, so the URI is passed through Vitest's
  // provide/inject channel rather than via process.env.
  project.provide('mongoUri', uri);

  return async () => {
    await replSet?.stop();
  };
}

declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string;
  }
}
