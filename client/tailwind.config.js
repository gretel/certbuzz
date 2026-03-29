/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cb-primary': '#4F46E5',
        'cb-dark': '#312E81',
        'cb-accent': '#818CF8',
      },
    },
  },
  plugins: [],
}
