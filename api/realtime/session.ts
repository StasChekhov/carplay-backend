type OpenAIRealtimeSessionResponse = {
  client_secret?: {
    value?: string;
  };
  expires_at?: string | number;
};

export const config = { runtime: 'edge' };

async function readJsonBody<T>(req: Request | any): Promise<T | undefined> {
  // Edge Request
  if (typeof req?.json === 'function') {
    return (await req.json()) as T;
  }

  // Body already parsed or provided
  if (req?.body) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body) as T;
    }
    if (req.body instanceof ArrayBuffer) {
      const text = new TextDecoder().decode(new Uint8Array(req.body));
      return JSON.parse(text) as T;
    }
    if (req.body instanceof Uint8Array) {
      const text = new TextDecoder().decode(req.body);
      return JSON.parse(text) as T;
    }
  }

  // As a fallback, read from stream
  if (req?.body && typeof req.body.getReader === 'function') {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const totalLength = chunks.reduce((acc, cur) => acc + cur.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(merged);
    return JSON.parse(text) as T;
  }

  return undefined;
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json' },
    });
  }

  // allow optional model override via body
  const payload = (await readJsonBody<{ model?: string }>(request)) || {};

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      'https://api.openai.com/v1/realtime/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: payload.model || 'gpt-4o-realtime-preview',
          voice: 'alloy',
          modalities: ['audio'],
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return new Response(text, { status: response.status });
    }

    const data = (await response.json()) as OpenAIRealtimeSessionResponse;

    return new Response(
      JSON.stringify({
        client_secret: data.client_secret?.value,
        expires_at: data.expires_at,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('aborted') ? 504 : 502;
    return new Response(
      JSON.stringify({
        error: 'Upstream request failed',
        details: message,
      }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
