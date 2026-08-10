/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Core palette
        void:    '#0b0d0f',
        surface: '#0f1217',
        panel:   '#141820',
        card:    '#1a2030',
        border:  '#1e2638',
        navy:    '#293049',
        // Accent — electric blue
        accent:  { DEFAULT: '#3b82f6', hover: '#60a5fa', dim: '#1d4ed8', glow: 'rgba(59,130,246,0.15)' },
        // Status
        success: { DEFAULT: '#10b981', dim: 'rgba(16,185,129,0.15)', text: '#34d399' },
        warn:    { DEFAULT: '#f59e0b', dim: 'rgba(245,158,11,0.12)',  text: '#fbbf24' },
        danger:  { DEFAULT: '#ef4444', dim: 'rgba(239,68,68,0.12)',   text: '#f87171' },
        // Text scale
        ink:     { DEFAULT: '#e2e8f0', muted: '#8892a4', faint: '#4a5568', ghost: '#2d3748' },
      },
      fontFamily: {
        sans:  ['Geist', 'system-ui', 'sans-serif'],
        mono:  ['Geist Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'grid-void': `
          linear-gradient(rgba(41,48,73,0.18) 1px, transparent 1px),
          linear-gradient(90deg, rgba(41,48,73,0.18) 1px, transparent 1px)
        `,
        'glow-accent': 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(59,130,246,0.12) 0%, transparent 70%)',
        'glow-card':   'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,130,246,0.06) 0%, transparent 100%)',
      },
      backgroundSize: {
        'grid': '32px 32px',
      },
      boxShadow: {
        'card':    '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
        'panel':   '0 2px 4px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.4)',
        'glow':    '0 0 0 1px rgba(59,130,246,0.3), 0 4px 24px rgba(59,130,246,0.12)',
        'glow-sm': '0 0 0 1px rgba(59,130,246,0.2), 0 2px 12px rgba(59,130,246,0.08)',
        'inset':   'inset 0 1px 0 rgba(255,255,255,0.04)',
      },
      keyframes: {
        'fade-in':   { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in':  { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'pulse-dot': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        'shimmer':   { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        'scan':      { from: { transform: 'translateY(-100%)' }, to: { transform: 'translateY(400%)' } },
        'glow-pulse':{ '0%,100%': { boxShadow: '0 0 0 1px rgba(59,130,246,0.2)' }, '50%': { boxShadow: '0 0 0 1px rgba(59,130,246,0.5), 0 0 20px rgba(59,130,246,0.15)' } },
      },
      animation: {
        'fade-in':    'fade-in 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-in':   'slide-in 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
        'pulse-dot':  'pulse-dot 1.4s ease-in-out infinite',
        'shimmer':    'shimmer 2.5s linear infinite',
        'scan':       'scan 2s linear infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
