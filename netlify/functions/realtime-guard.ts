import type { Handler } from '@netlify/functions';

type GuardRequestBody = {
  audio_base64?: string;
  mime_type?: string;
  model?: string;
};

type TranscriptionResponse = {
  text?: string;
};

const controllerTimeoutMs = 15000;
const transcriptionModel = 'whisper-1';
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function parseBody<T>(body?: string | null): T | undefined {
  if (!body) return undefined;
  return JSON.parse(body) as T;
}

function isBlockedHealthRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return blockedHealthPatterns.some((pattern) => pattern.test(normalized));
}

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
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
    };
  }

  let payload: GuardRequestBody;
  try {
    payload = parseBody<GuardRequestBody>(event.body) || {};
  } catch (error) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Invalid JSON body',
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  if (!payload.audio_base64) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'audio_base64 is required' }),
    };
  }

  const mimeType = payload.mime_type || 'audio/wav';
  const model = payload.model || transcriptionModel;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), controllerTimeoutMs);

  try {
    const audioBuffer = Buffer.from(payload.audio_base64, 'base64');
    const form = new FormData();
    const file = new Blob([audioBuffer], { type: mimeType });
    form.append('file', file, 'audio');
    form.append('model', model);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: response.status, headers: corsHeaders, body: text };
    }

    const data = (await response.json()) as TranscriptionResponse;
    const transcript = data.text?.trim() || '';
    const blocked = transcript ? isBlockedHealthRequest(transcript) : false;

    if (blocked) {
      return {
        statusCode: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Health-related requests are not supported.',
          blocked: true,
          transcript,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed: true, transcript }),
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
