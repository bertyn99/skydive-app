import { VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.vue'
import DashboardShell from './layouts/DashboardShell.vue'
import SessionView from './views/SessionView.vue'
import EvalsView from './views/EvalsView.vue'

const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: '/',
			component: DashboardShell,
			children: [
				{ path: '', name: 'session', component: SessionView },
				{ path: 'evals', name: 'evals', component: EvalsView },
			],
		},
		{ path: '/session', redirect: '/' },
		{ path: '/console', redirect: '/' },
	],
})

createApp(App)
	.use(createPinia())
	.use(router)
	.use(ui)
	.use(VueQueryPlugin)
	.mount('#root')
