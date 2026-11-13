<script setup lang="ts">
// Dashboard shell: sidebar navigation + router outlet. Rendered once, so the
// WebSocket session (and any eval run in flight) survives page navigation.
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import type { NavigationMenuItem } from "@nuxt/ui";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const { serverConnected } = storeToRefs(session);
const route = useRoute();

const navItems = computed<NavigationMenuItem[][]>(() => [
	[
		{
			label: "Session",
			icon: "i-lucide-video",
			to: "/",
			active: route.path === "/",
		},
		{
			label: "Evals",
			icon: "i-lucide-flask-conical",
			to: "/evals",
			active: route.path === "/evals",
		},
	],
]);

onMounted(() => {
	session.connect();
});
</script>

<template>
	<UDashboardGroup unit="rem">
		<UDashboardSidebar
			collapsible
			:min-size="13"
			:default-size="15"
			:max-size="17"
			:ui="{ footer: 'border-t border-default' }"
		>
			<template #header="{ collapsed }">
				<div v-if="!collapsed" class="flex flex-col gap-0.5">
					<span class="text-base font-semibold leading-tight tracking-tight text-highlighted">
						SkyGuide
					</span>
					<span class="font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
						Operator Console
					</span>
				</div>
				<UIcon
					v-else
					name="i-lucide-radar"
					class="size-5 shrink-0 text-primary"
				/>
			</template>

			<template #default="{ collapsed }">
				<UNavigationMenu
					:collapsed="collapsed"
					:items="navItems"
					orientation="vertical"
				/>

				<div
					v-if="!collapsed"
					class="mt-auto flex flex-col gap-1.5 rounded-md border border-default bg-elevated/50 p-2.5"
				>
					<span class="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dimmed">
						Silence is the default
					</span>
					<span class="text-[11px] leading-relaxed text-muted">
						The assistant speaks only when it adds value. Every output carries
						its provenance.
					</span>
				</div>
			</template>

			<template #footer="{ collapsed }">
				<div
					class="flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-muted"
					:class="collapsed ? 'justify-center' : 'w-full'"
				>
					<span
						class="size-[7px] shrink-0 rounded-full"
						:class="serverConnected
							? 'bg-primary shadow-[0_0_6px_rgba(45,212,191,0.5)]'
							: 'bg-error'"
						aria-hidden="true"
					/>
					<span v-if="!collapsed">
						{{ serverConnected ? "LINK ONLINE" : "LINK OFFLINE" }}
					</span>
				</div>
			</template>
		</UDashboardSidebar>

		<RouterView />
	</UDashboardGroup>
</template>
