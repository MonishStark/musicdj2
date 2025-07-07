/** @format */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./migrations",
	schema: "./shared/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		url: "postgresql://postgres:7372@localhost:5432/airemixer",
	},
});
