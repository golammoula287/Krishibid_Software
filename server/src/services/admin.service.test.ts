import { roleSatisfies, type CategoryInput } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { User, makeUser } from '../test/factories.js';
import { Category } from '../models/Category.js';
import {
  createCategory,
  deactivateCategory,
  listAllCategories,
  setUserRole,
  setUserStatus,
  updateCategory,
} from './admin.service.js';

/**
 * The line between an admin and a super admin.
 *
 * Two levels are only worth having if the boundary holds, and the boundary is one specific thing:
 * an admin must never be able to change who else is an administrator. An admin who could appoint
 * one could entrench themselves; an admin who could demote one could lock everybody else out.
 */
describe('the admin / super admin boundary', () => {
  const superadmin = { id: 'unused', role: 'superadmin' as const };

  it('lets a super admin appoint an admin, and kills their existing sessions', async () => {
    const user = await makeUser('buyer');
    const before = (await User.findById(user._id).lean())?.tokenVersion ?? 0;

    await setUserRole({ ...superadmin, id: String((await makeUser('admin'))._id) }, String(user._id), 'admin');

    const after = await User.findById(user._id).lean();
    expect(after?.role).toBe('admin');
    // Tokens carry the role they were minted with, so a change that left them alive would leave
    // the old permissions in force until they happened to expire.
    expect(after?.tokenVersion).toBe(before + 1);
  });

  it('refuses an ordinary admin trying to appoint another', async () => {
    const admin = await makeUser('admin');
    const user = await makeUser('buyer');

    await expect(
      setUserRole({ id: String(admin._id), role: 'admin' }, String(user._id), 'admin'),
    ).rejects.toMatchObject({ status: 403 });

    expect((await User.findById(user._id).lean())?.role).toBe('buyer');
  });

  it('refuses anybody changing their own role', async () => {
    const boss = await makeUser('admin');

    // Demoting yourself could leave the platform with no super admin at all, and nothing in the
    // application can create another one.
    await expect(
      setUserRole({ id: String(boss._id), role: 'superadmin' }, String(boss._id), 'buyer'),
    ).rejects.toMatchObject({ code: 'cannot_change_own_role' });
  });

  it('refuses an admin suspending another admin', async () => {
    const actor = await makeUser('admin');
    const target = await makeUser('admin');

    await expect(
      setUserStatus({ id: String(actor._id), role: 'admin' }, String(target._id), 'suspended', 'because'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('never lets a super admin be suspended, even by another super admin', async () => {
    const actor = await makeUser('admin');
    const target = await makeUser('admin');
    await User.updateOne({ _id: target._id }, { $set: { role: 'superadmin' } });

    await expect(
      setUserStatus(
        { id: String(actor._id), role: 'superadmin' },
        String(target._id),
        'suspended',
        'because',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('lets an admin suspend a farmer, which is the normal case', async () => {
    const actor = await makeUser('admin');
    const farmer = await makeUser('farmer');

    await setUserStatus(
      { id: String(actor._id), role: 'admin' },
      String(farmer._id),
      'suspended',
      'listed goods they did not have',
    );

    const after = await User.findById(farmer._id).select('+refreshTokenHash').lean();
    expect(after?.accountStatus).toBe('suspended');
    // Suspension has to end their sessions, or they keep working until a token expires.
    expect(after?.refreshTokenHash).toBeNull();
  });
});

describe('role hierarchy', () => {
  it('lets a super admin through every admin gate', () => {
    // This is what stops every existing `requireRole('admin')` needing to be found and widened —
    // and a gate somebody forgets keeps refusing rather than starts allowing.
    expect(roleSatisfies('admin', 'superadmin')).toBe(true);
    expect(roleSatisfies('superadmin', 'superadmin')).toBe(true);
  });

  it('does not let an admin through a super admin gate', () => {
    expect(roleSatisfies('superadmin', 'admin')).toBe(false);
  });

  it('keeps farmers and buyers entirely separate', () => {
    expect(roleSatisfies('farmer', 'buyer')).toBe(false);
    expect(roleSatisfies('buyer', 'farmer')).toBe(false);
    expect(roleSatisfies('admin', 'farmer')).toBe(false);
  });
});

/**
 * What the marketplace is allowed to sell.
 *
 * The one rule worth defending here is that a category's address is permanent. Listings reference
 * it by slug and nothing else, so a rename is a silent orphaning: the lot survives, its category
 * does not resolve, and the buyer sees a slug where a name should be.
 */
describe('the category catalogue', () => {
  /** What the route hands the service: validation has already applied every default. */
  const honey = (): CategoryInput => ({
    slug: 'honey',
    names: { bn: 'মধু', en: 'Honey' },
    units: ['kg', 'litre'],
    perishable: false,
    order: 50,
    active: true,
  });

  it('adds one that the marketplace immediately offers', async () => {
    await createCategory(honey());

    const listed = await listAllCategories();
    expect(listed.map((c) => c.slug)).toContain('honey');
    expect(listed.find((c) => c.slug === 'honey')?.active).toBe(true);
  });

  it('refuses a second category at the same address', async () => {
    await createCategory(honey());

    await expect(
      createCategory({ ...honey(), names: { bn: 'অন্য', en: 'Other' } }),
    ).rejects.toMatchObject({ code: 'category_exists' });
  });

  it('renames the label but never the address', async () => {
    await createCategory(honey());

    // A client sending a slug is trying to move it. The update takes the names and drops that.
    await updateCategory('honey', {
      slug: 'raw-honey',
      names: { bn: 'কাঁচা মধু', en: 'Raw honey' },
    } as never);

    const listed = await listAllCategories();
    expect(listed.map((c) => c.slug)).toContain('honey');
    expect(listed.map((c) => c.slug)).not.toContain('raw-honey');
    expect(listed.find((c) => c.slug === 'honey')?.names.en).toBe('Raw honey');
  });

  it('deactivates rather than deletes, so existing listings keep their category name', async () => {
    await createCategory(honey());

    await deactivateCategory('honey');

    // Still on record for anything already filed under it...
    const all = await listAllCategories();
    expect(all.find((c) => c.slug === 'honey')?.active).toBe(false);
    // ...and gone from what the public catalogue offers.
    const offered = await Category.find({ active: true }).lean();
    expect(offered.map((c) => c.slug)).not.toContain('honey');
  });

  it('says so when the category does not exist', async () => {
    await expect(deactivateCategory('nothing-here')).rejects.toThrow();
    await expect(updateCategory('nothing-here', { order: 1 })).rejects.toThrow();
  });
});
