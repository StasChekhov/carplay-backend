import * as crypto from 'crypto';

type OpenAIRealtimeSessionResponse = {
  client_secret?: {
    value?: string;
  };
  expires_at?: string | number;
};

type SessionRequestBody = {
  model?: string;
  user_text?: string;
  text?: string;
  prompt?: string;
  query?: string;
  transcript?: string;
  guard_token?: string;
};

const blockedHealthPatterns: RegExp[] = [
  /\bdiet\b/,
  /\bcalories?\b/,
  /\bcaloric\b/,
  /\bmacro(s)?\b/,
  /\bnutrition\b/,
  /\bmeal plan\b/,
  /\bprotein\b/,
  /\bcarb(s)?\b/,
  /\bfat\b/,
  /\bweight loss\b/,
  /\blose weight\b/,
  /\bgain muscle\b/,
  /\bbmi\b/,
  /\bbody fat\b/,
  /\bkcal\b/,
  /\bsupplement(s)?\b/,
  /\bvitamin(s)?\b/,
  /диет/,
  /калор/,
  /макрос/,
  /питан/,
  /план питания/,
  /белок/,
  /углевод/,
  /жир/,
  /похуд/,
  /сбросить вес/,
  /набрать масс/,
  /имт/,
  /индекс массы тела/,
  /ккал/,
  /добавк/,
  /витамин/,
];

function isBlockedHealthRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return blockedHealthPatterns.some((pattern) => pattern.test(normalized));
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const normalized = padded + '='.repeat(padLength);
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function isValidGuardToken(token: string, secret: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, signatureB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (signatureB64 !== expectedSig) return false;
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as {
      exp?: number;
      allowed?: boolean;
    };
    if (!payload.allowed || !payload.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp >= now;
  } catch {
    return false;
  }
}

const safetySystemPrompt = [
  'You are SmartDrive Voice, an in-car voice assistant.',
  '',
  'IMPORTANT SAFETY RULES:',
  'You must NOT provide:',
  '- medical advice',
  '- health-related recommendations',
  '- diagnosis or treatment suggestions',
  '- interpretation of symptoms',
  '- medication or dosage information',
  '- diet recommendations or meal plans',
  '- macro calculations, calorie targets, or nutrition prescriptions',
  '',
  'If the user asks any health, medical, or nutrition-related question:',
  '- Politely refuse',
  '- State that you cannot provide medical or nutrition advice',
  '- Advise the user to consult a qualified healthcare professional',
  '- Do NOT provide recommendations, calculations, or personalized guidance',
  '',
  'You may assist only with:',
  '- general conversation',
  '- driving-related assistance',
  '- productivity',
  '- navigation-style help',
  '- non-medical informational requests',
].join('\n');

export default async function handler(request?: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const guardSecret = process.env.GUARD_TOKEN_SECRET;
  let payload: SessionRequestBody | undefined;

  if (request) {
    try {
      payload = (await request.json()) as SessionRequestBody;
    } catch {
      payload = undefined;
    }
  }

  const userText =
    payload?.user_text ??
    payload?.text ??
    payload?.prompt ??
    payload?.query ??
    payload?.transcript;
  if (userText && isBlockedHealthRequest(userText)) {
    return new Response(
      JSON.stringify({
        error: 'Health-related requests are not supported.',
        blocked: true,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
      { status: 500 }
    );
  }
  if (!guardSecret) {
    return new Response(
      JSON.stringify({ error: 'GUARD_TOKEN_SECRET is missing' }),
      { status: 500 }
    );
  }

  if (!payload?.guard_token || !isValidGuardToken(payload.guard_token, guardSecret)) {
    return new Response(
      JSON.stringify({
        error: 'Guard verification failed.',
        blocked: true,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload?.model || 'gpt-4o-realtime-preview',
      voice: 'alloy',
      modalities: ['audio'],
      instructions: safetySystemPrompt,
    }),
  });

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
}
