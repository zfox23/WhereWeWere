/** @type {import('tailwindcss').Config} */
const colorVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: colorVar('--color-primary-50'),
          100: colorVar('--color-primary-100'),
          200: colorVar('--color-primary-200'),
          300: colorVar('--color-primary-300'),
          400: colorVar('--color-primary-400'),
          500: colorVar('--color-primary-500'),
          600: colorVar('--color-primary-600'),
          700: colorVar('--color-primary-700'),
          800: colorVar('--color-primary-800'),
          900: colorVar('--color-primary-900'),
          950: colorVar('--color-primary-950'),
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
