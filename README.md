# Swipt Chat

A Swipt swiplet (plugin) that puts an AI agent inside Swipt. Phase 1 keeps the
Swipt host untouched and verifies the core loop: chat UI → streaming model →
(planned) MCP device tools.

## What is here

- `src/App.tsx` — chat UI built on React Native core components only.
- `src/chat.ts` — OpenAI-compatible chat completion over SSE using
  `@swipt/api/http`; includes an offline mock so the UI works before a key is set.
- `src/sse.ts` — SSE line parsing, host-free so it can be tested with Node.
- `src/utf8.ts` — incremental UTF-8 decoder (split code points across chunks).
- `src/settings.ts` — endpoint/model/key stored in the swiplet data directory.
- `src/extension.ts` — placeholder action; device automation lands here later.

## Commands

```sh
npm install --legacy-peer-deps
npm run check   # tsc
npm test        # SSE + UTF-8 checks under Node
npm run build   # dist/swiptpi.swiplet
```

## Not verified yet

The runtime (rendering inside Swipt, real streaming, storage) needs the swiplet
deployed into the Swipt app; this machine has no Swipt build installed.
