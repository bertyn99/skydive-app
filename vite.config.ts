import vue from '@vitejs/plugin-vue'
import { nitro } from "nitro/vite"
import ui from '@nuxt/ui/vite'
import electron from "vite-plugin-electron/simple"
import { defineConfig } from 'vite'

// Player mode (`--mode player`) adds the Electron shell via
// vite-plugin-electron: `pnpm dev:player` builds + relaunches the desktop
// runtime against the dev server, `pnpm build:player` emits dist-electron
// for electron-builder. Plain `pnpm dev` / `pnpm build` stay untouched.
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    ui({
      ui: {
        colors: { primary: 'teal', neutral: 'slate' },
      },
    }),
    nitro(),
    ...(mode === "player"
      ? [
          electron({
            main: { entry: "electron/main.ts" },
            preload: { input: "electron/preload.ts" },
          }),
        ]
      : []),
  ],
}))
