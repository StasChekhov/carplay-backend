type OfferRequestBody = {
  sdp: string;
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

  let body: OfferRequestBody;
  try {
    body = (await request.json()) as OfferRequestBody;
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Invalid JSON body',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!body?.sdp) {
    return new Response(JSON.stringify({ error: 'SDP is required' }), {
      status: 400,
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.openai.com/v1/realtime', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/sdp',
      },
      body: body.sdp,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(text, { status: response.status });
    }

    const answerSdp = await response.text();

    return new Response(JSON.stringify({ sdp: answerSdp }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
