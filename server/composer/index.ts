// server/composer — public API of the composer module.
//
// Everything outside this module (engine.ts, API routes, future Electron
// main) imports from here only. Internal layout is free to change:
//
//   service.ts              registry + fallback chain + compose()
//   providers/*             one file per engine (gemini cloud, local VLM)
//   config.ts               shared env + compose contract + prompts
//
// Architecture mirrors server/voice: providers → config → (public APIs only),
// registry entries carry kind (cloud/local) + probe(), dispatch measures
// latency and falls down the chain with provenance.

export {
	COMPOSER_ENGINE_IDS,
	composerEngineLabel,
	compose,
	defaultComposerEngine,
	isComposerEngineId,
	probeComposerEngine,
	resolveComposerEngine,
	type ComposerEngineId,
	type ComposerEngineProbe,
	type ComposerProvenance,
	type ComposerResult,
} from "./service";
export type { ComposeInput, ComposeOutput } from "./config";
