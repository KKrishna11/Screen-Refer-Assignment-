import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";

export const GET = route(async (req) => json({ user: await requireUser(req) }));
