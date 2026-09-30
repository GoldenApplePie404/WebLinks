/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
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
      },
      keyframes: {
        // 悬浮球轻微上下浮动
        'ai-float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        // 呼吸光圈：放大 + 淡出
        'ai-ping': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '80%, 100%': { transform: 'scale(2)', opacity: '0' },
        },
      },
      animation: {
        'ai-float': 'ai-float 3s ease-in-out infinite',
        'ai-ping': 'ai-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
    }
  },
  plugins: []
}
