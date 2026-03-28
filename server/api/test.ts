import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
	status: "ok",
	message: "test route working",
}));
