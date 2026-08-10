// JSON response helper
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Error response
export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// Parse JSON body
export async function parseBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) throw new Error("invalid request");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 16_384) throw new Error("request too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error("request too large");
  if (!text.trim()) return {} as T;
  try { return JSON.parse(text) as T; } catch { throw new Error("invalid request"); }
}

// Extract path params from URL pattern matching
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

// CORS preflight handler
export function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
