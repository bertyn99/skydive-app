import { VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.vue'

const router = createRouter({
	routes: [{ path: '/', component: App }],
	history: createWebHistory(),
})

createApp(App)
	.use(createPinia())
	.use(router)
	.use(ui)
	.use(VueQueryPlugin)
	.mount('#root')
