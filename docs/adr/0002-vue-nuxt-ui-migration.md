# Vue 3 + Nuxt UI over React

The operator console was React 19 (with the React Compiler) backed by a zustand store.
We migrated to Vue 3 with the Composition API, Nuxt UI v4 (Vue plugin, Tailwind CSS v4),
Pinia for session state, and TanStack Vue Query for REST server-state (realtime stays on
the WebSocket).

Why: the roadmap (Situations/evals dashboard, engine picker, tables, drawers, forms)
leans heavily on a batteries-included component system, and Nuxt UI's Vue-first stack
(Reka UI + Tailwind Variants + semantic theming) gives that for free while matching the
maintainer's Vue/Nuxt expertise. The session logic (capture loop, voice, audio queue,
binary WS frames) was already DOM-free, so the port kept behavior identical: the store
moved from zustand to a Pinia setup store, the five panels became SFCs, and the
framework-free `src/utils` modules are untouched.

## Considered options

- **Staying on React 19 + Compiler**: no component library with this depth of theming in
  the React ecosystem without a heavier design-system investment.
- **Nuxt (framework) instead of Vue + Vite**: rejected for now — the Nitro backend is
  already wired through `nitro/vite` with a WebSocket route and custom build; adopting
  the full Nuxt framework is a larger change with no immediate payoff. Vue Query covers
  server-state; revisit if SSR/routing needs appear.
- **Naive UI / PrimeVue / Radix Vue directly**: Nuxt UI wraps Reka UI (Radix Vue's
  successor) and adds Tailwind theming, which we want anyway.

## Consequences

- Typechecking runs through `vue-tsc` (`pnpm build` = `vue-tsc -b && vite build`).
- ESLint uses `eslint-plugin-vue` (flat recommended, adapted to the repo's tab style).
- React Compiler memoization guarantees are gone; follow the reactivity discipline in
  AGENTS.md (`shallowRef` for primitives/opaque handles, `computed` for derivations).
- AGENTS.md documents the Vue conventions that replace the old React ones.
