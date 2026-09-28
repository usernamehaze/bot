/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        charcoal: '#121214',
        // glossy neon pink accent
        pink: {
          glow: '#FF1493',
          soft: '#FF69B4',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'pink-glow': '0 0 30px rgba(255, 20, 147, 0.45)',
      },
      keyframes: {
        pulseDot: {
          '0%, 60%, 100%': { opacity: '0.25' },
          '30%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
