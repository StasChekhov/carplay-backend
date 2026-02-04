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
  /\bhealth\b/,
  /\bmedical\b/,
  /\bmedicine\b/,
  /\bmedication\b/,
  /\bdrug(s)?\b/,
  /\bpharmacy\b/,
  /\bpharmac(y|ist)\b/,
  /\bprescription(s)?\b/,
  /\bprescribe(d|s)?\b/,
  /\bdiagnos(e|is|ed|ing)\b/,
  /\bsymptom(s)?\b/,
  /\btreatment(s)?\b/,
  /\btherapy\b/,
  /\bside effect(s)?\b/,
  /\bcontraindication(s)?\b/,
  /\ballergy|allergic\b/,
  /\binfection(s)?\b/,
  /\bfever\b/,
  /\bheadache\b/,
  /\bpain\b/,
  /\bchest pain\b/,
  /\bblood pressure\b/,
  /\bhypertension\b/,
  /\bhypotension\b/,
  /\bheart rate\b/,
  /\bpulse\b/,
  /\bglucose\b/,
  /\bdiabet(es|ic)\b/,
  /\binsulin\b/,
  /\bcholesterol\b/,
  /\bcondition(s)?\b/,
  /\bmental health\b/,
  /\bdepression\b/,
  /\banxiety\b/,
  /\btherapist\b/,
  /\bcounseling\b/,
  /\bdoctor\b/,
  /\bphysician\b/,
  /\bclinic\b/,
  /\bhospital\b/,
  /\bambulance\b/,
  /\ber\b/,
  /\bemergency\b/,
  /\bdiet\b/,
  /\bcalories?\b/,
  /\bcaloric\b/,
  /\bmacro(s)?\b/,
  /\bnutrition\b/,
  /\bmeal(s)?\b/,
  /\bmeal plan\b/,
  /\bmeal planning\b/,
  /\bprotein\b/,
  /\bcarb(s)?\b/,
  /\bfat\b/,
  /\bweight loss\b/,
  /\blose weight\b/,
  /\bgain muscle\b/,
  /\bbmi\b/,
  /\bbody fat\b/,
  /\bkcal\b/,
  /\bkilocalorie(s)?\b/,
  /\bmetabolism\b/,
  /\bmetabolic\b/,
  /\bbulking\b/,
  /\bcutting\b/,
  /\bintermittent fasting\b/,
  /\bfasting\b/,
  /\bsupplement(s)?\b/,
  /\bprotein powder\b/,
  /\bcreatine\b/,
  /\bpre[-\s]?workout\b/,
  /\bpost[-\s]?workout\b/,
  /\bvitamin(s)?\b/,
  /\bmineral(s)?\b/,
  /\bomega[-\s]?3\b/,
  /\bprobiotic(s)?\b/,
  /\bdeficiency\b/,
  /\bdeficient\b/,
  /диет/,
  /диета/,
  /калор/,
  /калори/,
  /макрос/,
  /питан/,
  /план питания/,
  /белок/,
  /углевод/,
  /жир/,
  /похуд/,
  /похудеть/,
  /снижен(ие|ия) веса/,
  /сбросить вес/,
  /набрать масс/,
  /набор масс/,
  /имт/,
  /индекс массы тела/,
  /ккал/,
  /килокал/,
  /калори(я|и)/,
  /метабол/,
  /добавк/,
  /витамин/,
  /минерал/,
  /лекарств/,
  /медицин/,
  /медикамент/,
  /симптом/,
  /диагноз/,
  /лечение/,
  /терапи/,
  /побочн/,
  /противопоказ/,
  /давление/,
  /температур/,
  /жар/,
  /боль/,
  /грудн/,
  /сердц/,
  /пульс/,
  /инсулин/,
  /диабет/,
  /холестерин/,
  /врач/,
  /клиник/,
  /больниц/,
  /скорая/,
  /экстренн/,
];
const safetySystemPrompt = [
  'You are SmartDrive Voice, an in-car voice assistant.',
  '',
  'CRITICAL SAFETY RULES (NO EXCEPTIONS):',
  'You must NOT provide:',
  '- medical advice',
  '- health-related recommendations',
  '- diagnosis or treatment suggestions',
  '- interpretation of symptoms',
  '- medication names, dosage, or OTC guidance',
  '- diet recommendations or meal plans',
  '- macro calculations, calorie targets, or nutrition prescriptions',
  '',
  'If the user asks any health, medical, or nutrition-related question:',
  '- Respond with this exact refusal, and nothing else:',
  '"I’m not able to provide medical or nutrition advice. Please consult a qualified healthcare professional."',
  '- Do not add follow-up questions, warnings, or alternative suggestions.',
  '- Do not mention any medications or health-related details.',
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
          input_audio_transcription: { model: 'whisper-1' },
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
