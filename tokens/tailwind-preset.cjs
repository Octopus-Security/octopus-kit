'use strict';
// Tailwind preset: maps colour names to the kit's CSS variables, so `bg-surface`,
// `text-muted`, `border-border`, `bg-accent` follow the user's theme and the app's accent.
//
//   // tailwind.config.js
//   module.exports = { presets: [require('octopus-kit/tokens/tailwind-preset.cjs')], content: [...] };
//
// Caveats: (1) colours are CSS variables, so Tailwind's opacity modifiers (`bg-accent/20`) do not
// work on them; use the `color-mix` utilities in a small CSS rule, or a solid token.
// (2) octopus-math remaps Tailwind's own blue/green to its palette; do NOT add this preset there
// blindly, it would not conflict by name but would change which colours the app can say.
// (3) The preset moves Tailwind's `sm` from 640px to 480px; an app with existing `sm:` utilities
// will see them apply earlier. Check them before adopting.
const v = (name) => `var(--o-${name})`;
const tokens = require('./tokens.json');
const bp = (n) => tokens.shared[`bp-${n}`];

module.exports = {
  theme: {
    extend: {
      // The kit's breakpoints (tokens.json "bp-*"). `sm` is overridden: Tailwind's default is 640px.
      // 2xl is left at Tailwind's 1536px. Keep these equal to ui/layout.css; a test does.
      screens: { sm: bp('sm'), md: bp('md'), lg: bp('lg'), xl: bp('xl') },
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        border: v('border'),
        text: { DEFAULT: v('text'), muted: v('muted'), dim: v('dim') },
        muted: v('muted'),
        dim: v('dim'),
        accent: { DEFAULT: v('accent'), hover: v('accent-hover'), ink: v('accent-ink') },
        success: v('success'),
        warn: v('warn'),
        danger: v('danger'),
        info: v('info'),
      },
      borderRadius: { sm: v('radius-sm'), md: v('radius-md'), lg: v('radius-lg') },
      fontFamily: { sans: [v('font-sans')], mono: [v('font-mono')] },
      boxShadow: { 1: v('shadow-1'), 2: v('shadow-2') },
    },
  },
};
