import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const origins = new Set(["http://127.0.0.1:3100", "http://localhost:3100"]);
if (process.env.PUBLIC_ORIGIN) origins.add(new URL(process.env.PUBLIC_ORIGIN).origin);
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!path.every((part) => /^[a-zA-Z0-9_-]+$/.test(part)))
    return Response.json({ error: "Invalid path" }, { status: 400 });
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (
      (origin && !origins.has(origin)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json(
        { error: "Cross-site request denied" },
        { status: 403 },
      );
  }
  try {
    const response = await fetch(
      `${process.env.EXCHANGE_URL || "http://127.0.0.1:8088"}/api/${path.join("/")}`,
      {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          Cookie: request.headers.get("cookie") || "",
        },
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text(),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) headers.set("set-cookie", cookie);
    return new Response(await response.text(), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json(
      {
        error:
          "Exchange unavailable. An earlier submission may have executed; retry with the same command ID.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as DELETE };
