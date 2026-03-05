/**
 * PATCH /api/admin/users/[id]/role
 * Delegates to the shared patchUserRole handler.
 */

import { NextRequest } from "next/server";
import { patchUserRole } from "../../route";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(
    request: NextRequest,
    { params }: RouteParams
): Promise<Response> {
    const { id } = await params;
    return patchUserRole(request, id);
}
