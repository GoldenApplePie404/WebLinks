/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './mlp.html',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#FF9700',
        'primary-dark': '#E07B00',
        'primary-darker': '#B86300',
        'primary-light': '#FFB347',
        'primary-lighter': '#FFD699',
        'primary-bg': '#FFF3E6',
        secondary: '#5B6470',
        accent: '#FF5E3A',
        dark: '#241A0E',
        light: '#FFFBF5'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
