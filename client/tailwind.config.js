/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'azure-blue': '#0078D4',
        'azure-dark': '#004578',
        'azure-light': '#50E6FF',
      },
    },
  },
  plugins: [],
}
