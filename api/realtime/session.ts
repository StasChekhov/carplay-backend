type OpenAIRealtimeSessionResponse = {
  client_secret?: {
    value?: string;
  };
  expires_at?: string | number;
};

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json' },
    });
  }

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
          model: 'gpt-4o-realtime-preview',
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
