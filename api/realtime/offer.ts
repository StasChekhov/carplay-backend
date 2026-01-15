type OfferRequestBody = {
  sdp: string;
};

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
      { status: 500 }
    );
  }

  const body = (await request.json()) as OfferRequestBody;

  if (!body?.sdp) {
    return new Response(JSON.stringify({ error: 'SDP is required' }), {
      status: 400,
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/realtime', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/sdp',
      },
      body: body.sdp,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return new Response(
      JSON.stringify({
        error: 'Upstream request failed',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    return new Response(text, { status: response.status });
  }

  const answerSdp = await response.text();

  return new Response(JSON.stringify({ sdp: answerSdp }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
