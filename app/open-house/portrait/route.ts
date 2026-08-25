export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const source = new URL("/open-house/mike-ehinger-hq.b64", request.url);
  const response = await fetch(source, { cache: "no-store" });

  if (!response.ok) {
    return new Response("Portrait unavailable", { status: 502 });
  }

  const base64 = (await response.text()).trim();
  const bytes = Buffer.from(base64, "base64");

  if (!bytes.length) {
    return new Response("Portrait unavailable", { status: 502 });
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Content-Disposition": "inline; filename=\"mike-ehinger-open-house.jpg\"",
    },
  });
}
