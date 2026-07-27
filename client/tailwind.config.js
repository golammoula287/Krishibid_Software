/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Agricultural green, dark enough for AA contrast on white at body sizes.
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
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
