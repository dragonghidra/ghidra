const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        'agent-night': '#05070d',
        'agent-ink': '#0f1623',
        'agent-violet': '#7c5dff',
        'agent-fuchsia': '#f35de0',
        'agent-cyan': '#5ef2ff',
        'agent-emerald': '#4de1b0',
      },
      backgroundImage: {
        'agent-gradient':
          'radial-gradient(circle at 10% 20%, rgba(124,93,255,0.75), transparent 45%), radial-gradient(circle at 80% 0%, rgba(94,242,255,0.25), transparent 55%), radial-gradient(circle at 50% 60%, rgba(243,93,224,0.4), transparent 60%)',
      },
      boxShadow: {
        'glass-xl': '0 20px 80px rgba(5, 7, 13, 0.75)',
      },
    },
  },
  plugins: [],
};
