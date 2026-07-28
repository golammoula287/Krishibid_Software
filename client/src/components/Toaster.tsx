import { useTranslation } from 'react-i18next';
import { useToast, type Toast } from '../lib/toast.js';

const TONE_STYLES: Record<Toast['tone'], { box: string; icon: string }> = {
  // Warning, not error, for outbid/closed: those are normal auction outcomes, and showing
  // them in red would make ordinary behaviour look like a malfunction.
  error: { box: 'border-red-300 bg-red-50 text-red-900', icon: '⚠' },
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-900', icon: '!' },
  info: { box: 'border-brand-200 bg-brand-50 text-brand-900', icon: '✓' },
};

export default function Toaster() {
  const { t } = useTranslation();
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    /**
     * Above the mobile bottom nav, below the header. `aria-live="polite"` so a screen
     * reader announces messages without interrupting — and `role="status"` rather than
     * `alert`, because most of these are outcomes rather than emergencies.
     */
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-4 md:bottom-6"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const style = TONE_STYLES[toast.tone];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto w-full max-w-md rounded-2xl border shadow-lg ${style.box}`}
          >
            <div className="flex items-start gap-3 p-3.5">
              <span aria-hidden className="mt-0.5 text-base font-bold leading-none">
                {style.icon}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{toast.title}</p>
                {toast.hint && <p className="mt-1 text-xs leading-snug opacity-80">{toast.hint}</p>}

                {toast.fields && toast.fields.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs opacity-90">
                    {toast.fields.slice(0, 4).map((f, i) => (
                      <li key={`${f.path}-${i}`}>
                        {f.path && <span className="font-medium">{f.path}: </span>}
                        {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={t('common.close')}
                className="-m-1 min-h-touch min-w-[2.75rem] shrink-0 rounded-lg p-1 text-lg leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
