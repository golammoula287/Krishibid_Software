import type {
  ContactMessageDto,
  DeliveryQueueItemDto,
  ManagedUserDto,
  Role,
  Unit,
} from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/icons.js';
import { CardSkeleton, EmptyState, ErrorNote, Spinner } from '../components/ui.js';
import {
  useAdminOverview,
  useAssignDelivery,
  useDeliveryQueue,
  useManagedUsers,
  useSetContactStatus,
  useSetUserRole,
  useSetUserStatus,
  useAllCategories,
  useSaveCategory,
  useDeactivateCategory,
} from '../lib/admin.js';
import { useAuth } from '../lib/auth.js';
import { useContactMessages } from '../lib/content.js';
import { formatBdt, formatDate, formatNumber } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * Where the platform is actually run from.
 *
 * Before this, "admin" was two unrelated pages and an API nothing rendered: messages arrived and
 * nobody knew, deliveries sat unassigned, and suspending an account meant opening the database.
 *
 * The overview leads with the numbers that represent somebody waiting — farmers who cannot earn
 * until they are approved, messages nobody has read, consignments nobody has dispatched. Volume
 * and money come after, because they are interesting rather than urgent.
 */

type Tab = 'overview' | 'delivery' | 'messages' | 'users' | 'categories';

function Stat({
  icon,
  label,
  value,
  tone = 'slate',
  to,
  onSelect,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone?: 'urgent' | 'brand' | 'slate';
  to?: string;
  onSelect?: () => void;
}) {
  const tones = {
    urgent: 'bg-amber-50 text-amber-700 ring-amber-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-100',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  };

  const body = (
    <div className="card flex items-center gap-3 py-3 transition hover:shadow-md">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${tones[tone]}`}
      >
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-xl font-bold tabular-nums text-slate-900">{value}</p>
      </div>
    </div>
  );

  /**
   * A count of people waiting is not information, it is a job — so the ones that have somewhere to
   * be actioned are the control that takes you there. `to` leaves the page, `onSelect` switches
   * tab within it.
   */
  if (to) return <Link to={to}>{body}</Link>;
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className="w-full text-left">
        {body}
      </button>
    );
  }
  return body;
}

function Overview({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const overview = useAdminOverview();

  if (overview.isLoading) return <CardSkeleton count={3} />;
  if (overview.isError) {
    return <ErrorNote error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  const data = overview.data;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Things with a person waiting at the other end. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('admin.needsYou')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            icon="review"
            tone={data.pendingApprovals > 0 ? 'urgent' : 'slate'}
            label={t('admin.pendingApprovals')}
            value={formatNumber(data.pendingApprovals, locale)}
            to="/admin/review"
          />
          <Stat
            icon="advisor"
            tone={data.unreadMessages > 0 ? 'urgent' : 'slate'}
            label={t('admin.unreadMessages')}
            value={formatNumber(data.unreadMessages, locale)}
            onSelect={() => onNavigate('messages')}
          />
          <Stat
            icon="orders"
            tone={data.awaitingDispatch > 0 ? 'urgent' : 'slate'}
            label={t('admin.awaitingDispatch')}
            value={formatNumber(data.awaitingDispatch, locale)}
            onSelect={() => onNavigate('delivery')}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('admin.money')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            icon="shield"
            tone="brand"
            label={t('admin.escrowHeld')}
            value={formatBdt(data.escrowHeldPoisha, locale)}
          />
          {/* Released payments only. Held ones have not changed hands, and this is the figure
              most likely to be quoted at somebody. */}
          <Stat
            icon="trending"
            tone="brand"
            label={t('admin.settledSales', { count: data.settledOrderCount })}
            value={formatBdt(data.settledSalesPoisha, locale)}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('admin.activity')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon="trending"
            label={t('admin.liveAuctions')}
            value={formatNumber(data.listings.auction, locale)}
          />
          <Stat
            icon="basket"
            label={t('admin.liveFixed')}
            value={formatNumber(data.listings.fixed, locale)}
          />
          <Stat
            icon="sprout"
            label={t('admin.newFarmers')}
            value={formatNumber(data.newUsersThisWeek.farmer, locale)}
          />
          <Stat
            icon="account"
            label={t('admin.newBuyers')}
            value={formatNumber(data.newUsersThisWeek.buyer, locale)}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="font-bold text-brand-900">{t('admin.ordersByStatus')}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ['awaitingPayment', data.orders.awaitingPayment],
              ['confirmed', data.orders.confirmed],
              ['inTransit', data.orders.inTransit],
              ['completed', data.orders.completed],
              ['disputed', data.orders.disputed],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs text-slate-500">{t(`admin.order.${key}`)}</dt>
              <dd
                className={`text-lg font-bold tabular-nums ${
                  key === 'disputed' && value > 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {formatNumber(value, locale)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function DeliveryBoard() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [status, setStatus] = useState<'awaiting_dispatch' | 'dispatched'>('awaiting_dispatch');
  const queue = useDeliveryQueue(status);
  const assign = useAssignDelivery();

  const [openFor, setOpenFor] = useState<string | null>(null);
  const [agent, setAgent] = useState({ agentName: '', agentPhone: '', trackingNote: '' });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['awaiting_dispatch', 'dispatched'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            className={`badge ${status === key ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-800'}`}
          >
            {t(`admin.delivery.${key}`)}
          </button>
        ))}
      </div>

      {queue.isLoading && <CardSkeleton count={2} />}
      {queue.data?.length === 0 && <EmptyState icon="orders" title={t('admin.delivery.empty')} />}

      {queue.data?.map((item: DeliveryQueueItemDto) => (
        <div key={item.orderId} className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-brand-900">
                {item.productName} · {formatNumber(item.quantity, locale)}
              </p>
              <p className="mt-0.5 text-sm text-slate-600">
                {t('admin.delivery.from')} {item.supplierName} ({item.supplierDistrict})
              </p>
              <p className="text-sm text-slate-600">
                {t('admin.delivery.to')} {item.buyerName} · {item.buyerPhone}
              </p>
            </div>
            <span className="badge bg-brand-50 text-brand-800">
              {formatBdt(item.delivery.chargePoisha, locale)}
            </span>
          </div>

          {item.delivery.addressLine && (
            <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-700">
              {item.delivery.addressLine}, {item.delivery.district}
              {item.delivery.contactPhone && ` · ${item.delivery.contactPhone}`}
              {item.delivery.note && (
                <span className="mt-1 block text-xs text-slate-500">{item.delivery.note}</span>
              )}
            </p>
          )}

          {item.delivery.agentName ? (
            <p className="mt-3 text-sm text-slate-700">
              <span className="font-semibold">{t('admin.delivery.agent')}: </span>
              {item.delivery.agentName} · {item.delivery.agentPhone}
              {item.delivery.dispatchedAt && (
                <span className="ml-1 text-xs text-slate-500">
                  ({formatDate(item.delivery.dispatchedAt, locale)})
                </span>
              )}
            </p>
          ) : openFor === item.orderId ? (
            <form
              className="mt-3 space-y-2 border-t border-brand-50 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                assign.mutate(
                  { orderId: item.orderId, input: agent },
                  {
                    onSuccess: () => {
                      setOpenFor(null);
                      setAgent({ agentName: '', agentPhone: '', trackingNote: '' });
                    },
                  },
                );
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="field"
                  placeholder={t('admin.delivery.agentName')}
                  value={agent.agentName}
                  onChange={(e) => setAgent({ ...agent, agentName: e.target.value })}
                  required
                  minLength={2}
                />
                <input
                  className="field"
                  inputMode="numeric"
                  placeholder={t('admin.delivery.agentPhone')}
                  value={agent.agentPhone}
                  onChange={(e) => setAgent({ ...agent, agentPhone: e.target.value })}
                  required
                />
              </div>
              <input
                className="field"
                placeholder={t('admin.delivery.trackingNote')}
                value={agent.trackingNote}
                onChange={(e) => setAgent({ ...agent, trackingNote: e.target.value })}
              />
              {assign.isError && <ErrorNote error={assign.error} />}
              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1" disabled={assign.isPending}>
                  {assign.isPending ? t('common.loading') : t('admin.delivery.markDispatched')}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setOpenFor(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="btn-primary mt-3 w-full sm:w-auto"
              onClick={() => setOpenFor(item.orderId)}
            >
              {t('admin.delivery.assign')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Inbox() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const messages = useContactMessages();
  const setStatus = useSetContactStatus();

  if (messages.isLoading) return <CardSkeleton count={3} />;
  if (messages.data?.length === 0) {
    return <EmptyState icon="advisor" title={t('admin.inbox.empty')} />;
  }

  return (
    <div className="space-y-3">
      {messages.data?.map((message: ContactMessageDto) => (
        <div
          key={message.id}
          className={`card ${message.status === 'new' ? 'border-brand-200 bg-brand-50/40' : ''}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-brand-900">{message.subject}</p>
              <p className="text-sm text-slate-600">
                {message.name} · <span className="break-all">{message.email}</span>
              </p>
            </div>
            <span className="text-xs text-slate-500">{formatDate(message.createdAt, locale)}</span>
          </div>

          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {message.message}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {/* Replying happens in a mail client — building an outbound mail feature on a
                platform whose mail is currently disabled would be the wrong order. */}
            <a href={`mailto:${message.email}?subject=Re: ${message.subject}`} className="btn-secondary text-sm">
              {t('admin.inbox.reply')}
            </a>
            {message.status === 'new' && (
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setStatus.mutate({ id: message.id, status: 'read' })}
              >
                {t('admin.inbox.markRead')}
              </button>
            )}
            {message.status !== 'archived' && (
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setStatus.mutate({ id: message.id, status: 'archived' })}
              >
                {t('admin.inbox.archive')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const me = useAuth((s) => s.user);
  const isSuper = me?.role === 'superadmin';

  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const users = useManagedUsers({ q, ...(role ? { role } : {}) });
  const setStatus = useSetUserStatus();
  const setRoleFor = useSetUserRole();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field"
          type="search"
          placeholder={t('admin.users.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="field sm:w-48"
          value={role}
          onChange={(e) => setRole(e.target.value as Role | '')}
        >
          <option value="">{t('admin.users.allRoles')}</option>
          <option value="farmer">{t('auth.farmer')}</option>
          <option value="buyer">{t('auth.buyer')}</option>
          <option value="admin">{t('admin.users.admin')}</option>
        </select>
      </div>

      {users.isLoading && <Spinner />}

      <div className="space-y-2">
        {users.data?.map((user: ManagedUserDto) => (
          <div key={user.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-brand-900">{user.name}</p>
                <p className="text-sm text-slate-600">
                  {user.phone} · <span className="break-all">{user.email}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t(`admin.users.role.${user.role}`)}
                  {user.supplierType && ` · ${t(`supplier.${user.supplierType}`)}`}
                  {' · '}
                  {user.district} · {formatDate(user.createdAt, locale)}
                </p>
              </div>
              <span
                className={`badge shrink-0 ${
                  user.accountStatus === 'active'
                    ? 'bg-brand-100 text-brand-800'
                    : user.accountStatus === 'suspended'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                {t(`admin.users.status.${user.accountStatus}`)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {user.accountStatus === 'active' ? (
                <button
                  type="button"
                  className="btn-secondary text-sm text-red-700"
                  onClick={() =>
                    setStatus.mutate({
                      userId: user.id,
                      status: 'suspended',
                      reason: t('admin.users.suspendedByAdmin'),
                    })
                  }
                >
                  {t('admin.users.suspend')}
                </button>
              ) : user.accountStatus === 'suspended' ? (
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() =>
                    setStatus.mutate({ userId: user.id, status: 'active', reason: 'reinstated' })
                  }
                >
                  {t('admin.users.reinstate')}
                </button>
              ) : null}

              {/* Only a super admin sees these, and the API refuses them regardless — the
                  hiding is a courtesy, the refusal is the protection. */}
              {isSuper && user.role === 'buyer' && (
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setRoleFor.mutate({ userId: user.id, role: 'admin' })}
                >
                  {t('admin.users.makeAdmin')}
                </button>
              )}
              {isSuper && user.role === 'admin' && (
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setRoleFor.mutate({ userId: user.id, role: 'buyer' })}
                >
                  {t('admin.users.removeAdmin')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


const ALL_UNITS: Unit[] = ['kg', 'litre', 'piece', 'dozen', 'sack', 'maund'];

const BLANK_CATEGORY = {
  slug: '',
  bn: '',
  en: '',
  units: ['kg'] as Unit[],
  perishable: false,
  order: 100,
};

/**
 * What the marketplace is allowed to sell.
 *
 * Adding one should not need a deploy: a crop coming into season, or a product line somebody
 * starts bringing, arrives faster than a release cycle.
 *
 * Removing is deactivation, never deletion — every listing already filed under a category
 * references it by slug, and deleting would leave those showing a raw slug where their category
 * name should be. Inactive takes it out of the rail and the listing form while keeping the name
 * resolvable for the lots that already point at it.
 */
function Categories() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const categories = useAllCategories();
  const save = useSaveCategory();
  const deactivate = useDeactivateCategory();

  const [form, setForm] = useState(BLANK_CATEGORY);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>): void => setForm({ ...form, ...patch });
  const reset = (): void => {
    setForm(BLANK_CATEGORY);
    setEditingSlug(null);
  };

  const toggleUnit = (unit: Unit): void => {
    const next = form.units.includes(unit)
      ? form.units.filter((u) => u !== unit)
      : [...form.units, unit];
    // At least one, or the listing form would offer a category nothing can be measured in.
    if (next.length > 0) set({ units: next });
  };

  const submit = (): void => {
    const input = {
      ...(editingSlug ? {} : { slug: form.slug }),
      names: { bn: form.bn, en: form.en },
      units: form.units,
      perishable: form.perishable,
      order: Number(form.order),
    };
    save.mutate({ slug: editingSlug ?? undefined, input }, { onSuccess: reset });
  };

  const canSubmit =
    form.bn.trim() && form.en.trim() && (editingSlug || /^[a-z0-9-]{2,}$/.test(form.slug));

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-brand-900">
            {editingSlug ? t('admin.categories.editing', { slug: editingSlug }) : t('admin.categories.new')}
          </h2>
          {editingSlug && (
            <button type="button" onClick={reset} className="text-sm text-brand-700 underline">
              {t('common.cancel')}
            </button>
          )}
        </div>

        {!editingSlug && (
          <div>
            <label htmlFor="cat-slug" className="label">
              {t('admin.categories.slug')}
            </label>
            <input
              id="cat-slug"
              className="field"
              placeholder="honey"
              value={form.slug}
              onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
            />
            {/* Said once, here: the address is what listings reference, so it is fixed after
                creation and renaming is not offered. */}
            <p className="mt-1 text-xs text-slate-500">{t('admin.categories.slugHelp')}</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cat-en" className="label">
              {t('admin.categories.nameEn')}
            </label>
            <input
              id="cat-en"
              className="field"
              value={form.en}
              onChange={(e) => set({ en: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="cat-bn" className="label">
              {t('admin.categories.nameBn')}
            </label>
            <input
              id="cat-bn"
              className="field"
              value={form.bn}
              onChange={(e) => set({ bn: e.target.value })}
            />
          </div>
        </div>

        <div>
          <span className="label">{t('admin.categories.units')}</span>
          <div className="flex flex-wrap gap-2">
            {ALL_UNITS.map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => toggleUnit(unit)}
                className={`badge ${
                  form.units.includes(unit)
                    ? 'bg-brand-700 text-white'
                    : 'bg-brand-50 text-brand-800'
                }`}
              >
                {t(`units.${unit}`)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('admin.categories.unitsHelp')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.perishable}
              onChange={(e) => set({ perishable: e.target.checked })}
              className="h-4 w-4"
            />
            {t('admin.categories.perishable')}
          </label>
          <div>
            <label htmlFor="cat-order" className="label">
              {t('admin.categories.order')}
            </label>
            <input
              id="cat-order"
              type="number"
              className="field"
              value={form.order}
              onChange={(e) => set({ order: Number(e.target.value) })}
            />
          </div>
        </div>

        {save.isError && <ErrorNote error={save.error} />}

        <button
          type="button"
          className="btn-primary w-full"
          disabled={!canSubmit || save.isPending}
          onClick={submit}
        >
          {save.isPending ? t('common.loading') : t('common.save')}
        </button>
      </section>

      <section className="space-y-2">
        {categories.isLoading && <CardSkeleton count={2} />}
        {categories.data?.map((category) => (
          <div
            key={category.slug}
            className={`card ${category.active === false ? 'opacity-60' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-brand-900">
                  {category.names[locale]}{' '}
                  <span className="text-xs font-normal text-slate-400">/{category.slug}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {category.units.map((u) => t(`units.${u}`)).join(' · ')}
                  {category.perishable && ` · ${t('admin.categories.perishable')}`}
                </p>
              </div>
              {category.active === false && (
                <span className="badge bg-slate-200 text-slate-600">
                  {t('admin.categories.inactive')}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => {
                  setEditingSlug(category.slug);
                  setForm({
                    slug: category.slug,
                    bn: category.names.bn,
                    en: category.names.en,
                    units: category.units,
                    perishable: category.perishable,
                    order: category.order,
                  });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {t('blog.edit')}
              </button>
              {category.active === false ? (
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() =>
                    save.mutate({ slug: category.slug, input: { active: true } })
                  }
                >
                  {t('admin.categories.reactivate')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary text-sm text-red-700"
                  onClick={() => deactivate.mutate(category.slug)}
                >
                  {t('admin.categories.deactivate')}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: { key: Tab; icon: IconName }[] = [
    { key: 'overview', icon: 'insights' },
    { key: 'delivery', icon: 'orders' },
    { key: 'messages', icon: 'advisor' },
    { key: 'users', icon: 'account' },
    { key: 'categories', icon: 'market' },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{t('admin.title')}</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            {me?.role === 'superadmin' ? t('admin.superAdmin') : t('admin.administrator')}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/review" className="btn-secondary text-sm">
            {t('nav.review')}
          </Link>
          <Link to="/admin/blog" className="btn-secondary text-sm">
            {t('nav.manageBlog')}
          </Link>
        </div>
      </header>

      <div className="-mx-4 flex gap-1 overflow-x-auto border-b border-brand-100 px-4">
        {tabs.map(({ key, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              tab === key
                ? 'border-brand-600 text-brand-800'
                : 'border-transparent text-slate-500 hover:text-brand-800'
            }`}
          >
            <Icon name={icon} className="h-4 w-4" />
            {t(`admin.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview onNavigate={setTab} />}
      {tab === 'delivery' && <DeliveryBoard />}
      {tab === 'messages' && <Inbox />}
      {tab === 'users' && <Users />}
      {tab === 'categories' && <Categories />}
    </div>
  );
}
