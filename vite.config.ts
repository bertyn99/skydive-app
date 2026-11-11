import vue from '@vitejs/plugin-vue'
import { nitro } from "nitro/vite"
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    ui({
      ui: {
        colors: { primary: 'teal', neutral: 'slate' },
      },
    }),
    nitro(),
  ],
})
