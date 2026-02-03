import type { Handler } from '@netlify/functions';
import * as crypto from 'crypto';

type GuardRequestBody = {
  audio_base64?: string;
  mime_type?: string;
  model?: string;
  transcript?: string;
  text?: string;
};

type TranscriptionResponse = {
  text?: string;
};

const controllerTimeoutMs = 15000;
const transcriptionModel = 'whisper-1';
const guardTokenTtlSeconds = 120;
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

function base64UrlEncode(input: string | Buffer): string {
  const base64 = Buffer.from(input).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signGuardToken(secret: string, expiresAt: number): string {
  const payload = JSON.stringify({ exp: expiresAt, allowed: true });
  const payloadB64 = base64UrlEncode(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const signatureB64 = signature;
  return `${payloadB64}.${signatureB64}`;
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
  const guardSecret = process.env.GUARD_TOKEN_SECRET;
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

  const textFallback = (payload.transcript ?? payload.text ?? '').trim();
  const mimeType = payload.mime_type || 'audio/wav';
  const model = payload.model || transcriptionModel;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), controllerTimeoutMs);

  try {
    let transcript = textFallback;
    if (payload.audio_base64) {
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
      transcript = data.text?.trim() || '';
    }
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

    const expiresAt = Math.floor(Date.now() / 1000) + guardTokenTtlSeconds;
    const token = signGuardToken(guardSecret, expiresAt);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allowed: true,
        transcript,
        guard_token: token,
        expires_at: expiresAt,
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
