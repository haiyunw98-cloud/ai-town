/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    fontFamily: {
      display: ['var(--font-display)', 'sans-serif'],
      body: ['var(--font-body)', 'monospace'],
    },
    extend: {
      colors: {
        brown: {
          100: '#FFFFFF',
          200: '#F4ECD8',
          300: '#E6B85C',
          500: '#B76B4D',
          700: '#73483B',
          800: '#3D3430',
          900: '#172D30',
        },
        clay: {
          100: '#DDE9E5',
          300: '#91B8AD',
          500: '#477B73',
          700: '#24555A',
          900: '#173F43',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
