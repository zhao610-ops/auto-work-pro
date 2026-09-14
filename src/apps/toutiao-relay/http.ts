export async function verifyBearerToken(
  request: Request,
  expected: string,
): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  const provided = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!expected || !provided || !await timingSafeEqual(provided, expected)) {
    return json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

export function ok<T>(data: T): Response {
  return json({ success: true, data });
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const leftDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", left),
  );
  const rightDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", right),
  );
  let diff = left.byteLength === right.byteLength ? 0 : 1;
  for (let index = 0; index < leftDigest.length; index++) {
    diff |= leftDigest[index] ^ rightDigest[index];
  }
  return diff === 0;
}
