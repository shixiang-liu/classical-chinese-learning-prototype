import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-error-container": "#93000a",
        "on-error": "#ffffff",
        "surface-bright": "#f9f9f7",
        "on-primary-container": "#7bacd5",
        "surface-container-highest": "#e2e3e1",
        "on-secondary": "#ffffff",
        "secondary-fixed": "#a2f5b6",
        "surface-variant": "#e2e3e1",
        "on-primary-fixed-variant": "#0e4b6e",
        "on-tertiary-container": "#d59c51",
        "outline-variant": "#c4c6cd",
        "secondary-fixed-dim": "#86d89b",
        "on-secondary-fixed-variant": "#005229",
        "surface-tint": "#2f6388",
        "surface": "#f9f9f7",
        "on-primary-fixed": "#001e30",
        "on-background": "#1a1c1b",
        "background": "#f9f9f7",
        "tertiary": "#392200",
        "on-primary": "#ffffff",
        "surface-dim": "#dadad8",
        "surface-container": "#eeeeec",
        "secondary-container": "#9ff2b3",
        "on-tertiary": "#ffffff",
        "error": "#ba1a1a",
        "tertiary-container": "#573500",
        "inverse-on-surface": "#f1f1ef",
        "error-container": "#ffdad6",
        "on-surface": "#1a1c1b",
        "inverse-primary": "#9bccf6",
        "primary-container": "#004062",
        "on-secondary-container": "#1b713e",
        "surface-container-low": "#f4f4f2",
        "surface-container-high": "#e8e8e6",
        "tertiary-fixed": "#ffddb7",
        "on-secondary-fixed": "#00210d",
        "surface-container-lowest": "#ffffff",
        "secondary": "#156c3b",
        "primary-fixed-dim": "#9bccf6",
        "on-surface-variant": "#43474c",
        "primary-fixed": "#cbe6ff",
        "primary": "#002941",
        "inverse-surface": "#2f3130",
        "tertiary-fixed-dim": "#f8bb6d",
        "outline": "#74777d",
        "on-tertiary-fixed-variant": "#653e00",
        "on-tertiary-fixed": "#2a1700"
      },
      fontFamily: {
        "headline": ["Noto Serif", "serif"],
        "body": ["Public Sans", "sans-serif"],
        "label": ["Public Sans", "sans-serif"]
      },
      borderRadius: {
        "sm": "0.125rem",
        "DEFAULT": "0.125rem", 
        "lg": "0.25rem", 
        "xl": "0.5rem", 
        "2xl": "0.75rem",
        "3xl": "1rem",
        "full": "9999px"
      },
      boxShadow: {
        'soft': '40px 0 40px -20px rgba(0, 41, 65, 0.06)',
        'card': '0 20px 50px -15px rgba(0, 41, 65, 0.08)'
      }
    },
  },
  plugins: [],
}

export default config
