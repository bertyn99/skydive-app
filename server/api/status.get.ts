import { defineEventHandler } from "nitro";

export default defineEventHandler(() => {
	return { status: "ok", uptime: process.uptime() };
});
