# MYAI Render Voice Bridge v0.6.2

Remote voice/AI bridge for **MYAI on an Official Bedrock server hosted at Falix**.

It runs separately on Render and connects to Falix through the Falix Public API console WebSocket. The Minecraft server itself stays on Falix.

## Render setup

Create a Render **Web Service** from this repository.

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Instance: Free
- Health URL: `/api/config`

Add Environment variables from `.env.example`. At minimum:

- `FALIX_API_KEY`
- `FALIX_SERVER_NAME=Motion Roleplay`
- `MYAI_ACCESS_TOKEN` (your own long random secret)
- `MYAI_CONFIG_SECRET` (another long random secret)
- at least one AI provider key, e.g. `GEMINI_API_KEY` or `OPENAI_API_KEY`

Do **not** put real API keys in GitHub.

## iPhone flow

1. Open the Render HTTPS URL in Safari.
2. In Minecraft: MYAI Settings Tablet → Mobile Voice / Cloud.
3. Set the Render URL as the bridge URL.
4. Generate a 6-digit pair code.
5. Pair in Safari.
6. Use Push-to-Talk.

For the cheapest initial test, use Browser TTS so reply audio is spoken by iPhone without a server-side TTS API call.

## Render Free behavior

The free service can sleep after a period without inbound traffic. While the MYAI Safari page is open it polls the bridge regularly, so active voice sessions keep receiving inbound requests. If the service was asleep, the first page load can take about a minute to wake it.
