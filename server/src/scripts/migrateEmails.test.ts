import mongoose from 'mongoose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../models/User.js';
import { makeUser } from '../test/factories.js';
import { migrateEmails } from './migrateEmails.js';

/**
 * The migration is only worth anything if it fixes the two failures that actually happen, so
 * both are reproduced here rather than described.
 *
 * Documents are inserted through the raw driver on purpose: they do not satisfy the current
 * schema — that is the whole problem — and the model would refuse to create them.
 */
const usersCollection = () => mongoose.connection.db!.collection('users');

async function insertLegacyUser(over: Record<string, unknown> = {}): Promise<mongoose.Types.ObjectId> {
  const _id = new mongoose.Types.ObjectId();
  await usersCollection().insertOne({
    _id,
    phone: `019${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
    name: 'Legacy User',
    // Pre-hashed; this suite never authenticates as these.
    passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY',
    role: 'buyer',
    district: 'Dhaka',
    locale: 'bn',
    accountStatus: 'active',
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
  return _id;
}

beforeEach(async () => {
  // Indexes survive the per-test truncation, and this suite drops and rebuilds one.
  await usersCollection().dropIndexes().catch(() => undefined);
});

afterAll(async () => {
  // Put them back: the database is shared with every other file in the run, and several of
  // them depend on the unique indexes being live.
  await User.createIndexes();
});

describe('the email migration', () => {
  it('unblocks a login that the required field would otherwise reject', async () => {
    const id = await insertLegacyUser();

    // The failure being fixed: every login saves the rotated refresh-token hash, and mongoose
    // validates the whole document on save.
    const before = await User.findById(id);
    before!.refreshTokenHash = 'deadbeef';
    await expect(before!.save()).rejects.toThrow(/email.*required/i);

    await migrateEmails();

    const after = await User.findById(id);
    after!.refreshTokenHash = 'deadbeef';
    await expect(after!.save()).resolves.toBeTruthy();
  });

  it('gives a placeholder that cannot reach a real person, and does not claim it is verified', async () => {
    const id = await insertLegacyUser();
    await migrateEmails();

    const user = await User.findById(id).lean();
    // `.invalid` is reserved by RFC 2606 and can never be registered, so a placeholder can
    // never accidentally deliver to a stranger.
    expect(user?.email).toBe(`user-${String(id)}@krishibid.invalid`);
    // Nobody proved this address, so nothing may treat it as proven.
    expect(user?.emailVerified).toBe(false);
  });

  it('builds the unique index that two null emails would otherwise block', async () => {
    await insertLegacyUser();
    await insertLegacyUser();

    await migrateEmails();

    const indexes = await usersCollection().indexes();
    const email = indexes.find((i) => i.key.email === 1);
    expect(email?.unique).toBe(true);

    // And it now does its job.
    const taken = await User.findOne({}).lean();
    await expect(
      usersCollection().insertOne({ ...taken, _id: new mongoose.Types.ObjectId() }),
    ).rejects.toThrow(/E11000/);
  });

  it('keeps the oldest account when two share an address, and placeholders the rest', async () => {
    const older = await insertLegacyUser({
      email: 'shared@example.test',
      createdAt: new Date('2020-01-01'),
    });
    const newer = await insertLegacyUser({
      email: 'shared@example.test',
      createdAt: new Date('2024-01-01'),
    });

    await migrateEmails();

    // The oldest is the likeliest real owner, and it is the least surprising rule to explain.
    expect((await User.findById(older).lean())?.email).toBe('shared@example.test');
    expect((await User.findById(newer).lean())?.email).toMatch(/@krishibid\.invalid$/);
  });

  it('changes nothing on a second run', async () => {
    await insertLegacyUser();
    await makeUser('farmer', { email: 'real@example.test' });

    await migrateEmails();
    const first = await usersCollection().find({}).sort({ _id: 1 }).toArray();

    await migrateEmails();
    const second = await usersCollection().find({}).sort({ _id: 1 }).toArray();

    expect(second.map((u) => u.email)).toEqual(first.map((u) => u.email));
    // An account that already had a real, verified address is left entirely alone.
    expect((await User.findOne({ email: 'real@example.test' }).lean())?.emailVerified).toBe(true);
  });
});
