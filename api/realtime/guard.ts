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
  return `${payloadB64}.${signature}`;
}

export default async function handler(request?: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const guardSecret = process.env.GUARD_TOKEN_SECRET;
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

  let payload: GuardRequestBody | undefined;
  if (request) {
    try {
      payload = (await request.json()) as GuardRequestBody;
    } catch {
      payload = undefined;
    }
  }

  const textFallback = (payload?.transcript ?? payload?.text ?? '').trim();
  const mimeType = payload?.mime_type || 'audio/wav';
  const model = payload?.model || transcriptionModel;

  let transcript = textFallback;
  if (payload?.audio_base64) {
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
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(text, { status: response.status });
    }

    const data = (await response.json()) as TranscriptionResponse;
    transcript = data.text?.trim() || '';
  }
  const blocked = transcript ? isBlockedHealthRequest(transcript) : false;

  if (blocked) {
    return new Response(
      JSON.stringify({
        error: 'Health-related requests are not supported.',
        blocked: true,
        transcript,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + guardTokenTtlSeconds;
  const token = signGuardToken(guardSecret, expiresAt);
  return new Response(
    JSON.stringify({
      allowed: true,
      transcript,
      guard_token: token,
      expires_at: expiresAt,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
