import { managerConfigSchema, type ManagerConfig } from "@/shared/schemas";

/** Parse a persisted manager config version snapshot JSON string. */
export function parseManagerSnapshot(json: string): ManagerConfig {
	return managerConfigSchema.parse(JSON.parse(json));
}
