# MYAI Render Voice Bridge v0.6.2

Remote voice/AI bridge for **MYAI on an Official Bedrock server hosted at Falix**.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/drmacze/MYAI-Voice-Bridge)

The Minecraft server stays on Falix. This Render service connects to the Falix console, receives MYAI state/pair events, sends player speech to an AI provider, and sends the structured result back into Minecraft. Safari on iPhone supplies the microphone and speaks the reply.

## Important

Use **MYAI v0.6.1 VoiceFix or newer** on the Bedrock server. The original v0.6.0 build did not emit the bridge request event required by mobile voice.

## One-tap Render setup

Tap **Deploy to Render** above. The included `render.yaml` creates a free Node web service in the **Singapore** region and asks for your `FALIX_API_KEY`.

Keep all real API keys in Render Environment Variables, never in GitHub.

After the first deploy, add at least one AI provider key in Render:

- `GEMINI_API_KEY` — also works for microphone transcription
- `OPENAI_API_KEY` — also works for microphone transcription
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`
- `DEEPSEEK_API_KEY`

Voice input requires **OpenAI or Gemini** for speech-to-text. Voice output defaults to iPhone/Safari speech synthesis, so it does not require a separate TTS API.

## iPhone flow

1. Open the Render HTTPS URL in Safari.
2. In Minecraft: **MYAI Settings Tablet → Mobile Voice / Cloud**.
3. Save the Render URL as the Cloud URL.
4. Generate a 6-digit pair code.
5. Enter the code in Safari.
6. Select an NPC and tap **Tap bicara**.

## Security

Never commit Falix/API keys to this repository. Render Environment Variables are the intended secret store.
