type GuardRequestBody = {
  audio_base64?: string;
  mime_type?: string;
  model?: string;
};

type TranscriptionResponse = {
  text?: string;
};

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

function isBlockedHealthRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return blockedHealthPatterns.some((pattern) => pattern.test(normalized));
}

export default async function handler(request?: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
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

  if (!payload?.audio_base64) {
    return new Response(
      JSON.stringify({ error: 'audio_base64 is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const mimeType = payload.mime_type || 'audio/wav';
  const model = payload.model || transcriptionModel;

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
  const transcript = data.text?.trim() || '';
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

  return new Response(
    JSON.stringify({ allowed: true, transcript }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
