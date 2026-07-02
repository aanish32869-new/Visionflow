export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Map all existing 'violet' classes to the Ecrio red palette
        violet: {
          50: '#fdf2f2',
          100: '#fbe2e2',
          200: '#f6c1c1',
          300: '#ef9999',
          400: '#e56464',
          500: '#d53939',
          600: '#C41E2A', // Base Ecrio Red
          700: '#a5151f',
          800: '#88151c',
          900: '#72171b',
          950: '#3f080c',
        }
      }
    },
  },
  plugins: [],
};