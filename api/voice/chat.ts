type VoiceChatRequest = {
  audio_base64?: string;
  mime_type?: string;
  model?: string;
  voice?: string;
};

type TranscriptionResponse = {
  text?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

const transcriptionModel = 'whisper-1';
const chatModel = process.env.CHAT_MODEL ?? 'gpt-4o-mini';
const ttsModel = process.env.TTS_MODEL ?? 'tts-1';
const defaultVoice = process.env.TTS_VOICE ?? 'alloy';

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
  /\bdizziness\b/,
  /\bnausea\b/,
  /\bfatigue\b/,
  /\bstress\b/,
  /\bheadache\b/,
  /\bpain\b/,
  /\bback pain\b/,
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
  /\bexercise\b/,
  /\bworkout\b/,
  /\bstretch(ing)?\b/,
  /\bposture\b/,
  /\brecovery\b/,
  /\bsleep\b/,
  /\bhydration\b/,
  /\bwellness\b/,
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
  /головокруж/,
  /тошнот/,
  /усталост/,
  /стресс/,
  /жар/,
  /боль/,
  /спин/,
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
  /сон/,
  /гидратац/,
  /вода/,
  /упражнен/,
  /растяж/,
  /поза/,
  /восстановлен/,
  /фитнес/,
];

const refusalText =
  "I can't help with that. Please consult a qualified healthcare professional.";

const safetySystemPrompt = [
  'You are SmartDrive Voice, an in-car voice assistant.',
  '',
  'CRITICAL SAFETY RULES (NO EXCEPTIONS):',
  'You must NEVER provide any medical, health, nutrition, fitness, or wellness advice.',
  'This includes causes, suggestions, tips, actions, follow-up questions, or any guidance.',
  'Do not mention medications, treatments, diets, calories, macros, exercise, recovery, sleep, hydration, or stress advice.',
  '',
  'If the user asks ANY health, medical, nutrition, pain, diet, calorie, fitness, or wellness-related question:',
  '- Respond with this exact three-sentence refusal (no extra text, no follow-up questions):',
  '"I’m sorry you’re experiencing that. I can’t help with medical or health-related questions. Please consult a qualified healthcare professional for proper guidance."',
  '- Stop the topic completely.',
  '',
  'You may assist only with:',
  '- general non-health-related topics',
  '- driving-related assistance',
  '- productivity',
  '- navigation-style help',
  '- general factual information unrelated to health',
].join('\n');

function isBlockedHealthRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return blockedHealthPatterns.some((pattern) => pattern.test(normalized));
}

export default async function handler(request?: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is missing' }), {
      status: 500,
    });
  }

  let payload: VoiceChatRequest;
  if (request) {
    try {
      payload = (await request.json()) as VoiceChatRequest;
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Invalid JSON body',
          details: error instanceof Error ? error.message : String(error),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } else {
    payload = {};
  }

  if (!payload.audio_base64) {
    return new Response(
      JSON.stringify({ error: 'audio_base64 is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const mimeType = payload.mime_type || 'audio/m4a';
  const audioBuffer = Buffer.from(payload.audio_base64, 'base64');
  const form = new FormData();
  const file = new Blob([audioBuffer], { type: mimeType });
  form.append('file', file, 'audio');
  form.append('model', transcriptionModel);

  const transcriptionResponse = await fetch(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    },
  );

  if (!transcriptionResponse.ok) {
    const text = await transcriptionResponse.text();
    return new Response(text, { status: transcriptionResponse.status });
  }

  const data = (await transcriptionResponse.json()) as TranscriptionResponse;
  const transcript = data.text?.trim() || '';

  if (!transcript) {
    return new Response(JSON.stringify({ error: 'Empty transcript' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (isBlockedHealthRequest(transcript)) {
    return new Response(
      JSON.stringify({ response: refusalText, blocked: true, transcript }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload.model || chatModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: safetySystemPrompt },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!chatResponse.ok) {
    const text = await chatResponse.text();
    return new Response(text, { status: chatResponse.status });
  }

  const chatData = (await chatResponse.json()) as ChatCompletionResponse;
  const reply =
    chatData.choices?.[0]?.message?.content?.trim() ??
    'Sorry, I cannot respond right now.';

  const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ttsModel,
      voice: payload.voice || defaultVoice,
      input: reply,
      format: 'mp3',
    }),
  });

  if (!ttsResponse.ok) {
    const text = await ttsResponse.text();
    return new Response(text, { status: ttsResponse.status });
  }

  const audioBytes = Buffer.from(await ttsResponse.arrayBuffer());
  const audio_base64 = audioBytes.toString('base64');

  return new Response(
    JSON.stringify({
      response: reply,
      audio_base64,
      mime_type: 'audio/mpeg',
      blocked: false,
      transcript,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
