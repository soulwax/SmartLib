import { auth } from "@/auth";
import LibraryPageClient from "@/components/library-page-client";
import { getLibraryBootstrapService } from "@/lib/resource-service";

const RESOURCE_PAGE_SIZE = 200;

async function getInitialLibrarySnapshot() {
  try {
    const session = await auth();
    const result = await getLibraryBootstrapService({
      userId: session?.user?.id ?? null,
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
