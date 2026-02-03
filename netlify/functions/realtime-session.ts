import type { Handler } from '@netlify/functions';
import * as crypto from 'crypto';

type OpenAIRealtimeSessionResponse = {
  client_secret?: { value?: string };
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

const controllerTimeoutMs = 15000;
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

function parseBody<T>(body?: string | null): T | undefined {
  if (!body) return undefined;
  return JSON.parse(body) as T;
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

function isBlockedHealthRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return blockedHealthPatterns.some((pattern) => pattern.test(normalized));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        ...corsHeaders,
        Allow: 'POST',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const guardSecret = process.env.GUARD_TOKEN_SECRET;
  const envModel = process.env.REALTIME_MODEL;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
    };
  }
  if (!guardSecret) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'GUARD_TOKEN_SECRET is missing' }),
    };
  }

  const payload = parseBody<SessionRequestBody>(event.body) || {};
  const userText =
    payload.user_text ??
    payload.text ??
    payload.prompt ??
    payload.query ??
    payload.transcript;
  if (userText && isBlockedHealthRequest(userText)) {
    return {
      statusCode: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Health-related requests are not supported.',
        blocked: true,
      }),
    };
  }

  if (!payload.guard_token || !isValidGuardToken(payload.guard_token, guardSecret)) {
    return {
      statusCode: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Guard verification failed.',
        blocked: true,
      }),
    };
  }

  const model = payload.model || envModel || 'gpt-4o-realtime-preview';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), controllerTimeoutMs);

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
          model,
          voice: 'verse',
          modalities: ['audio', 'text'],
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          instructions: safetySystemPrompt,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: response.status, headers: corsHeaders, body: text };
    }

    const data = (await response.json()) as OpenAIRealtimeSessionResponse;

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_secret: data.client_secret?.value,
        expires_at: data.expires_at,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('aborted') ? 504 : 502;
    return {
      statusCode: status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Upstream request failed',
        details: message,
      }),
    };
  } finally {
    clearTimeout(timeoutId);
  }
};
