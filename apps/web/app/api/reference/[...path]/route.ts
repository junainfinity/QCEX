import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (path.length !== 1 || !["stream", "snapshot", "candles"].includes(path[0]))
    return Response.json(
      { error: "Unknown market-data route" },
      { status: 404 },
    );
  const symbol = request.nextUrl.searchParams.get("symbol") || "BTCUSDT";
  const interval = request.nextUrl.searchParams.get("interval") || "1m";
  if (
    !["BTCUSDT", "ETHUSDT"].includes(symbol) ||
    !["1m", "5m", "15m", "1h", "4h", "1d"].includes(interval)
  )
    return Response.json(
      { error: "Unsupported market or interval" },
      { status: 400 },
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 10000);
  try {
    const upstream = await fetch(
      `${process.env.MARKET_DATA_URL || "http://127.0.0.1:8090"}/${path[0]}?symbol=${symbol}&interval=${interval}`,
      { cache: "no-store", signal: controller.signal, redirect: "error" },
    );
    clearTimeout(timeout);
    if (path[0] !== "stream" || !upstream.ok) {
      const text = await upstream.text();
      request.signal.removeEventListener("abort", abort);
      return new Response(text, {
        status: upstream.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    const reader = upstream.body!.getReader();
    const body = new ReadableStream({
      async pull(target) {
        try {
          const result = await reader.read();
          if (result.done) {
            target.close();
            request.signal.removeEventListener("abort", abort);
          } else target.enqueue(result.value);
        } catch (e) {
          target.error(e);
          abort();
          request.signal.removeEventListener("abort", abort);
        }
      },
      cancel() {
        abort();
        request.signal.removeEventListener("abort", abort);
        return reader.cancel();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    return Response.json(
      { error: "Live reference feed unavailable" },
      { status: 503 },
    );
  }
}
