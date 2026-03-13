export const ACTIVE_ORGANIZATION_STORAGE_KEY = "active-organization-id";
export const ACTIVE_WORKSPACE_STORAGE_KEY = "active-workspace-id";
export const LIBRARY_LOCATION_STORAGE_KEY = "library-location-v1";

export const ACTIVE_ORGANIZATION_COOKIE = "dv_active_organization_id";
export const ACTIVE_WORKSPACE_COOKIE = "dv_active_workspace_id";

export function normalizePersistedId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
