import type { Handler } from '@netlify/functions';

type OpenAIRealtimeSessionResponse = {
  client_secret?: { value?: string };
  expires_at?: string | number;
};

type SessionRequestBody = { model?: string };

const controllerTimeoutMs = 15000;
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
  '',
  'If the user asks any health or medical-related question:',
  '- Politely refuse',
  '- State that you cannot provide medical information',
  '- Advise the user to consult a qualified healthcare professional',
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
  const envModel = process.env.REALTIME_MODEL;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
    };
  }

  const payload = parseBody<SessionRequestBody>(event.body) || {};
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
