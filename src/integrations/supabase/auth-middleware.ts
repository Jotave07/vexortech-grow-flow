import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getActor, verifyJwt } from "@/backend/auth";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const claims = verifyJwt(token);
  if (!claims?.sub) throw new Response("Unauthorized: Invalid token", { status: 401 });

  const actor = await getActor(token);
  if (!actor) throw new Response("Unauthorized: User not found", { status: 401 });

  return next({
    context: {
      userId: actor.user.id,
      claims,
      actor,
    },
  });
});
