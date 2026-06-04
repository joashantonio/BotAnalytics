/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1a1d23',
        panel: '#22262f',
        border: '#2d3240',
        accent: '#3b82f6',
        buy: '#00c853',
        sell: '#f44336',
        avgbuy: '#ffd600',
        avgsell: '#9c27b0',
        psar: '#f57f17',
      },
    },
  },
  plugins: [],
}
