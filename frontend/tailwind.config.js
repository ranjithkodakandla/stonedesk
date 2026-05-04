/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        stone: '#1a1814',
        'stone-mid': '#2e2b26',
        'stone-light': '#3d3a33',
        quartz: '#f5f0e8',
        'quartz-dim': '#c8c0b0',
        gold: '#c9a84c',
        'gold-light': '#e8c96a',
        red: '#c94c4c',
        green: '#4caa6e',
        accent: '#6b9fd4',
        orange: '#d4874c',
      },
      fontFamily: {
        mono: ['DM Mono', 'monospace'],
        sans: ['Syne', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
