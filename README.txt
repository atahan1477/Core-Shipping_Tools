CORE SHIPPING TOOLS — CORRECTED STRUCTURE PACKAGE

Upload these files/folders to the ROOT of your GitHub repo.

Correct final structure:
- index.html
- firm-generator.html
- shared-state-example.html
- js/
  - firm-offer-app.js
  - shared-state-example.js
- shared/
  - config.js
  - offer-logic.js
  - store.js

Important:
- index.html must stay in repo root
- firm-generator.html must stay in repo root
- shared-state-example.html must stay in repo root
- firm-offer-app.js must be inside /js/
- shared-state-example.js must be inside /js/
- config.js, offer-logic.js, store.js must be inside /shared/

Delete any accidental wrong duplicates such as:
- /js/index.html
- /js/shared-state-example.html
- /js/README.txt
- /js/js/shared-state-example.js

After upload:
1. Commit to main
2. Wait for Vercel redeploy
3. Hard refresh the site

AI cargo-offer autofill (optional):
- Set `OPENAI_API_KEY` in Vercel project environment variables.
- Optional: set `OPENAI_AUTOFILL_MODEL` (default: `gpt-5-mini`).
- The generator will call `/api/ai-autofill` when "AI auto-fill from cargo offer" is clicked.
