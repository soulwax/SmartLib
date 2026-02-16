import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { listResourcesIncludingDeletedService } from "@/lib/resource-service";

export const runtime = "nodejs";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse("Authentication required.", 401);
  }

  if (!session.user.isAdmin) {
    return errorResponse("Admin access required.", 403);
  }

  try {
    const { mode, resources } = await listResourcesIncludingDeletedService();
    return NextResponse.json({ mode, resources });
  } catch (error) {
    console.error("Error in /api/admin/resources GET handler:", error);
    return errorResponse("Unexpected server error.", 500);
  }
}
