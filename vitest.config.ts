import { defineConfig } from "nitro-test-utils/config";

// Global Nitro test app: built once (dev mode) before the first test file and
// reused by all suites ($serverFetch). Unit suites (composer/voice packages)
// don't need it but share the worker (defineConfig sets isolate: false).
// include stays scoped to test/ so the .whisper.cpp / media trees on disk are
// never scanned (same reason eslint ignores them).
export default defineConfig(
	{ test: { include: ["test/**/*.test.ts"] } },
	{ global: true },
);
