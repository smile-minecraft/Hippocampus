import { NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth";

export async function GET() {
    if (process.env.NODE_ENV === "production") {
        return new Response("Not Found", { status: 404 });
    }

    try {
        // Provision a dummy ADMIN user token for local testing
        // You can use a real UUID from your db.user table if necessary,
        // but since we only check role in middleware, this is sufficient for UI testing.
        await setAuthCookies("00000000-0000-0000-0000-000000000000", "ADMIN");

        // Redirect back to the Audit dashboard where they received 401
        return NextResponse.redirect("http://localhost:3000/audit/exams");
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return new Response(`Dev Login Failed: ${msg}`, { status: 500 });
    }
}
