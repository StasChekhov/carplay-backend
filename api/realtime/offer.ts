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

  const response = await fetch('https://api.openai.com/v1/realtime', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/sdp',
    },
    body: body.sdp,
  });

  if (!response.ok) {
    const text = await response.text();
    return new Response(text, { status: response.status });
  }

  const answerSdp = await response.text();

  return new Response(JSON.stringify({ sdp: answerSdp }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
