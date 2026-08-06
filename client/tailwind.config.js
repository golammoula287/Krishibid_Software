/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Agricultural green, dark enough for AA contrast on white at body sizes.
         *
         * 300 and 950 are not decoration: `border-brand-300` was already being used by the
         * spinner and generated no class at all, so its ring fell back to `currentColor`. A
         * palette with holes in it fails silently — the class name looks right and does nothing.
         */
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },

        /**
         * The page itself.
         *
         * Was `brand-50` — a mint green — which tinted every screen and left the green accents
         * with nothing to be an accent against. A near-neutral warm grey lets produce photography
         * and the green chrome do the colouring instead of competing with a coloured background.
         */
        surface: {
          DEFAULT: '#fbfbfa',
          soft: '#f4f5f3',
        },
      },
      fontFamily: {
        // Bengali needs a font with proper conjunct/matra rendering; Noto Sans
        // Bengali is the safe cross-platform choice and degrades to system fonts.
        sans: ['"Noto Sans Bengali"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      minHeight: {
        // 44px is the minimum comfortable touch target.
        touch: '2.75rem',
      },
    },
  },
  plugins: [],
};
