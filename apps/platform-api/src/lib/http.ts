export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, paddle-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
} as const

export function withCors(headers?: HeadersInit): Headers {
  const next = new Headers(CORS_HEADERS)
  if (headers) {
    new Headers(headers).forEach((value, key) => next.set(key, value))
  }
  return next
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: withCors({
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    }),
  })
}

export function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: withCors(init.headers),
  })
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: withCors() })
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T
  }
  catch {
    throw new HttpError(400, "Invalid JSON body")
  }
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status })
  }

  const message = error instanceof Error ? error.message : "Unexpected error"
  return json({ error: message }, { status: 500 })
}
