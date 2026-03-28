# AGENTS.md - Skydive App Codebase Guide

This document provides essential context for AI coding agents working in this repository.

## Project Overview

- **Stack**: React 19 + TypeScript + Vite 8
- **Backend**: Nitro server (file-based API routes in `server/`)
- **Package Manager**: pnpm
- **React Compiler**: Enabled via `babel-plugin-react-compiler`

---

## Commands

```bash
# Development
pnpm dev              # Start Vite dev server with HMR

# Build
pnpm build            # TypeScript check (tsc -b) + Vite build

# Linting
pnpm lint             # Run ESLint on all files

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

### Import Conventions

```tsx
// Named imports first
import { useState, useEffect } from 'react'

// Default imports
import App from './App'

// Type imports (required for types only)
import type { ReactNode } from 'react'

// CSS imports
import './App.css'

// Asset imports
import logo from './assets/logo.svg'
```

### Component Structure

```tsx
// Function components with explicit return types preferred
function ComponentName(): JSX.Element {
  // Hooks at the top
  const [state, setState] = useState(initialValue)
  
  // Event handlers
  const handleClick = () => {
    setState(prev => prev + 1)
  }
  
  // JSX return
  return (
    <div onClick={handleClick}>
      {state}
    </div>
  )
}

export default ComponentName
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `UserProfile.tsx` |
| Hooks | camelCase with `use` prefix | `useUserData.ts` |
| Utilities | camelCase | `formatDate.ts` |
| API routes | kebab-case | `server/api/user-profile.ts` |
| CSS files | Match component | `UserProfile.css` |

### React Best Practices

1. **React Compiler is enabled** - Do NOT use:
   - `useMemo()` - compiler handles memoization
   - `useCallback()` - compiler handles memoization
   - `React.memo()` - compiler handles memoization

2. **Function components only** - No class components

3. **StrictMode enabled** - Components render twice in dev

4. **State updates** - Use functional updates for derived state:
   ```tsx
   setCount(prev => prev + 1)  // Correct
   setCount(count + 1)         // Avoid
   ```

5. **Event handlers** - Define inline or as const arrow functions:
   ```tsx
   const handleClick = () => { /* ... */ }
   // Or inline for simple cases
   <button onClick={() => setCount(c => c + 1)}>
   ```

### Error Handling

- Use try/catch for async operations
- Throw descriptive errors with context
- No empty catch blocks

```tsx
// Good
try {
  const data = await fetchData()
  return data
} catch (error) {
  throw new Error(`Failed to fetch data: ${error instanceof Error ? error.message : String(error)}`)
}
```

### CSS Conventions

- CSS files live alongside components
- Use semantic class names
- Follow existing patterns in `App.css` and `index.css`

---

## Project Structure

```
skydive-app/
├── src/
│   ├── main.tsx          # Entry point
│   ├── App.tsx           # Main app component
│   ├── App.css           # App styles
│   ├── index.css         # Global styles
│   └── assets/           # Static assets (images, SVGs)
├── server/
│   └── api/              # Nitro API routes (file-based)
├── public/               # Static files served at root
├── vite.config.ts        # Vite configuration
├── nitro.config.ts       # Nitro server configuration
├── tsconfig.json         # TypeScript project references
├── tsconfig.app.json     # App TypeScript config
└── tsconfig.node.json    # Build tools TypeScript config
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

1. Create `src/ComponentName.tsx`
2. Create `src/ComponentName.css` if needed
3. Import and use in parent component

### Adding an API Endpoint

1. Create `server/api/endpoint-name.ts`
2. Export default `defineEventHandler()`
3. Access via `/api/endpoint-name`

### Type Safety

- Never use `any` - use `unknown` and narrow
- Never use `@ts-ignore` or `@ts-expect-error`
- Always define proper types for props

```tsx
// Props interface
interface ButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

function Button({ label, onClick, disabled = false }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
```

---

## Forbidden Patterns

- `as any` - Never
- `@ts-ignore` / `@ts-expect-error` - Never
- `useMemo` / `useCallback` / `React.memo` - Not needed with React Compiler
- Class components - Never
- Empty catch blocks - Never
- Committing without explicit request - Never

---

## Environment

- **Node.js**: ES2023 features available
- **Browser**: Modern browsers (ES2023)
- **Timezone**: Europe/Paris
- **Locale**: en-US
