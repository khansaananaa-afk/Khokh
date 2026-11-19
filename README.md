# khokh (خوخ)

Chat website for coding and app design: live HTML preview, knowledge base, web search.

## Run
    npm install
    ANTHROPIC_API_KEY=... ADMIN_KEY=choose-a-long-secret npm start

## Environment variables
- ANTHROPIC_API_KEY  required (console.anthropic.com). Web search must be enabled for your org in the Console.
- ADMIN_KEY          required to upload/delete files and trigger web learning (type it in the "المعرفة" panel)
- DATA_DIR           where the knowledge base is stored (use a persistent disk on your host)
- LEARN_TOPICS       "topic one;topic two" -> khokh researches them on the web by itself and saves notes
- LEARN_EVERY_HOURS  how often (default 24). Each run costs API usage.
- RATE_LIMIT         requests per minute per IP (default 20, 0 = off)
- MAX_TOKENS         max reply length (default 4096)
- MODEL              default claude-sonnet-5-5

## How it learns
Files you upload and notes it writes from the web are stored, and the most relevant parts are
added to each question. The model weights do not change. Check "ويب" under the chat box to let
it search the web live for that question.
