import { cookies } from "next/headers";

import { auth } from "@/auth";
import LibraryPageClient from "@/components/library-page-client";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  ACTIVE_WORKSPACE_COOKIE,
  normalizePersistedId,
} from "@/lib/library-location";
import { getLibraryBootstrapService } from "@/lib/resource-service";

const RESOURCE_PAGE_SIZE = 200;

async function getInitialLibrarySnapshot() {
  try {
    const [session, cookieStore] = await Promise.all([auth(), cookies()]);
    const organizationId = normalizePersistedId(
      cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value,
    );
    const workspaceId = normalizePersistedId(
      cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value,
    );
    const result = await getLibraryBootstrapService({
      userId: session?.user?.id ?? null,
      organizationId,
      workspaceId,
      includeAllWorkspaces: session?.user?.isFirstAdmin === true,
      offset: 0,
      limit: RESOURCE_PAGE_SIZE,
    });

    return {
      mode: result.mode,
      organizationId: result.organizationId,
      workspaceId: result.workspaceId,
      resources: result.resources,
      nextOffset: result.nextOffset,
      categories: result.categories,
      organizations: result.organizations,
      workspaces: result.workspaces,
      workspaceCounts: result.workspaceCounts,
    };
  } catch {
    return null;
  }
}

export default async function Page() {
  const initialLibrarySnapshot = await getInitialLibrarySnapshot();

  return (
    <LibraryPageClient initialLibrarySnapshot={initialLibrarySnapshot} />
  );
}
