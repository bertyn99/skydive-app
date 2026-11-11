# AGENTS.md - Skydive App Codebase Guide

This document provides essential context for AI coding agents working in this repository.

## Project Overview

- **Stack**: Vue 3 (Composition API, `<script setup lang="ts">`) + TypeScript + Vite 8
- **UI**: Nuxt UI v4 (Vue plugin) + Tailwind CSS v4 + custom mission-control design tokens
- **State**: Pinia (`src/stores/session.ts` — the session store)
- **Server state**: TanStack Vue Query (wired; consumed by Stage 3+ for REST data)
- **Backend**: Nitro server (file-based API routes in `server/`), WebSocket at `/_ws`
- **Package Manager**: pnpm

---

## Commands

```bash
# Development
pnpm dev              # Start Vite dev server with HMR

# Build
pnpm build            # vue-tsc -b (typecheck incl. .vue SFCs) + Vite build

# Linting
pnpm lint             # Run ESLint (typescript-eslint + eslint-plugin-vue) on all files

# Preview
pnpm preview          # Preview production build locally
```

### Testing

No test framework is currently configured. When adding tests:
- Prefer Vitest for unit tests
- Run single test: `pnpm vitest run path/to/test.test.ts`
- Run with coverage: `pnpm vitest run --coverage`

---

## Code Style Guidelines

### TypeScript Configuration

- **Strict mode** enabled with additional checks:
  - `noUnusedLocals`, `noUnusedParameters`
  - `noFallthroughCasesInSwitch`
  - `verbatimModuleSyntax` (explicit type imports required)
- **Target**: ES2023
- **Module**: ESM with bundler resolution
- Typechecked with `vue-tsc` (`.ts` and `.vue`)

### Import Conventions

```ts
// Vue APIs first
import { computed, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'

// Types (required for types only)
import type { GameStateData } from '../../server/utils/protocol'

// Components in SFCs, css last
import StatusBar from './components/StatusBar.vue'
import './App.css'
```

### Component Structure (Vue SFC)

```vue
<script setup lang="ts">
// imports (vue, pinia, types, components, css)
// props/emits via defineProps/defineEmits if needed
// store wiring: const store = useSessionStore(); const { x } = storeToRefs(store)
// local state, computeds, handlers
</script>

<template>
	<!-- semantic HTML, kebab-case events, store actions on handlers -->
</template>
```

- Single-file components with `<script setup lang="ts">` always first
- Local components are imported explicitly; Nuxt UI `U*` components are globally registered

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase `.vue` | `GameStatePanel.vue` |
| Stores | camelCase `.ts`, `useXxxStore` | `stores/session.ts` → `useSessionStore` |
| Composables | camelCase with `use` prefix | `useUserData.ts` |
| Utilities | camelCase | `formatDate.ts` |
| API routes | kebab-case | `server/api/user-profile.ts` |
| CSS files | Match component | `GameStatePanel.css` |

### Vue Best Practices

1. **Composition API only** — no Options API
2. **Reactivity discipline**:
   - `shallowRef()` for primitive values and opaque handles (WebSocket, MediaStream)
   - `ref()`/`reactive()` only when deep reactivity is actually needed
   - Derive with `computed`; watchers only for side effects (`flush: 'post'` when touching DOM)
3. **Store access**: read state via `storeToRefs(store)`; call actions directly on the store
4. **Props down, events up** — never mutate props; `defineModel` for true two-way contracts
5. **Keep DOM interaction with its owning component** (template refs + `watchEffect`/watchers)
6. **Data fetching**: REST reads go through TanStack Vue Query (`useQuery`/`useMutation`); realtime stays on the WebSocket

### Nuxt UI Conventions

- Wrap the app in `UApp` (done in `App.vue` template root requirement: toasts/tooltips/overlays)
- Use semantic colors on components: `color="primary" | "error" | "neutral"`, never raw palette names
- Theme colors mapped in `vite.config.ts` (`primary: 'teal'`, `neutral: 'slate'`) — keep custom
  design tokens in `src/index.css` in sync with them
- Custom mission-control CSS (panels, stage HUD, status strip) lives in `src/App.css` and
  component-scoped files; Nuxt UI handles standard controls (UButton, USlider, UTextarea, …)

### Error Handling

- Use try/catch for async operations
- Throw descriptive errors with context
- No empty catch blocks

```ts
// Good
try {
	const data = await fetchData()
	return data
} catch (error) {
	throw new Error(`Failed to fetch data: ${error instanceof Error ? error.message : String(error)}`)
}
```

### CSS Conventions

- Design tokens live in `src/index.css` (imported before component CSS)
- CSS files live alongside components
- Use semantic class names
- Follow existing patterns in `App.css`

---

## Project Structure

```
skydive-app/
├── src/
│   ├── main.ts            # App bootstrap (Pinia, router, Nuxt UI, Vue Query)
│   ├── App.vue            # Console shell
│   ├── App.css            # Mission-control layout & components
│   ├── index.css          # Design tokens (imports Tailwind + Nuxt UI)
│   ├── components/        # Panel SFCs (*.vue + optional css)
│   ├── stores/            # Pinia stores (session.ts)
│   ├── utils/             # Framework-free logic (capture, voice, ws-binary)
│   └── assets/            # Static assets
├── server/
│   ├── api/               # Nitro API routes (file-based)
│   ├── routes/            # Nitro routes incl. /_ws WebSocket
│   └── utils/             # Engine, gemini, TTS/STT, protocol, connectors
├── public/                # Static files served at root
├── docs/adr/              # Architecture decision records
├── vite.config.ts         # Vite config (Vue + Nuxt UI + Nitro plugins)
└── tsconfig*.json         # TypeScript project references
```

---

## API Routes (Nitro)

API routes are auto-discovered in `server/api/`:

```ts
// server/api/hello.ts
export default defineEventHandler((event) => {
	return { message: 'Hello World' }
})
```

Access at: `GET /api/hello`

---

## Common Patterns

### Adding a New Component

1. Create `src/components/ComponentName.vue`
2. Create `src/components/ComponentName.css` if needed (import it in the SFC)
3. Import and use in the parent component

### Adding an API Endpoint

1. Create `server/api/endpoint-name.ts`
2. Export default `defineEventHandler()`
3. Access via `/api/endpoint-name`

### Type Safety

- Never use `any` - use `unknown` and narrow
- Never use `@ts-ignore` or `@ts-expect-error`
- Always define proper types for props

```vue
<script setup lang="ts">
interface ButtonProps {
	label: string
	onClick: () => void
	disabled?: boolean
}

const { label = '', onClick, disabled = false } = defineProps<ButtonProps>()
</script>
```

---

## Forbidden Patterns

- `as any` - Never
- `@ts-ignore` / `@ts-expect-error` - Never
- Options API - Never (Composition API with `<script setup>` only)
- React imports / JSX / `.tsx` files - Never (this is a Vue app)
- `ref()` for primitive state where `shallowRef()` suffices - avoid (see Reactivity discipline)
- Mutating props - Never (emit instead)
- Empty catch blocks - Never
- Committing without explicit request - Never

---

## Environment

- **Node.js**: ES2023 features available
- **Browser**: Modern browsers (ES2023)
- **Timezone**: Europe/Paris
- **Locale**: en-US

---

## Agent skills

### Issue tracker

Issues live in the Linear project **Skyguide** (team `YGG`, shared with the skyguide-skse repo), managed with the `linear` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role triage vocabulary, applied as Linear labels on team `YGG`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root + `docs/adr/`. See `docs/agents/domain.md`.
