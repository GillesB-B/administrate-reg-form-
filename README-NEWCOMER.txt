SUPER-SIMPLE SETUP (No coding, no terminal)

Goal: Get a live site like https://YOUR-SITE.netlify.app/e/MY-EVENT-CODE
This starter already supports ?legacyId=<123>, ?id=<GraphQLId>, and /e/<eventCode>.

STEP 1 — Create a GitHub repo
1) Go to https://github.com and sign up or sign in.
2) Click the + in the top-right → New repository.
3) Name it: administrate-reg-form → Create repository.
4) Click "Add file" → "Upload files".
5) On your computer, unzip this starter. Open the unzipped folder. Select EVERYTHING inside it (not the zip).
6) Drag the selected files/folders into GitHub's upload page.
   You must see at the top level:
   /public, /netlify, netlify.toml, .env.example, README-NEWCOMER.txt
7) Scroll down → "Commit changes".

STEP 2 — Create a Netlify site from that repo
1) Go to https://app.netlify.com → Sign up (use GitHub).
2) Click "Add new site" → "Import an existing project" → pick your GitHub repo.
3) Build settings:
   - Build command: (leave empty)
   - Publish directory: public
   - Functions directory: netlify/functions
4) Click "Deploy site". Wait for the green check.
   You'll get a URL like https://curly-otter-12345.netlify.app

STEP 3 — Add environment variables (REQUIRED)
In Netlify → your site → Site configuration → Environment variables → "Add a variable":

Add these (no quotes):
- ADMINISTRATE_GRAPHQL_ENDPOINT = https://<your-tenant>.getadministrate.com/graphql
- ADMINISTRATE_API_TOKEN = <RAW_TOKEN_ONLY>   (paste the token only; do NOT include the word "Bearer")
- ALLOWED_ORIGIN = *
- DEFAULT_ACCOUNT_ID = <the Account ID for new contacts>

Click Save. Then go to "Deploys" → "Trigger deploy" → "Clear cache and deploy site".

STEP 4 — Test
- Base site: https://<your-site>.netlify.app/
- Function alive: https://<your-site>.netlify.app/.netlify/functions/event
  (you should see: Provide ?code= or ?id= or ?legacyId=)
- With legacyId: https://<your-site>.netlify.app/?legacyId=383
- With event code: https://<your-site>.netlify.app/e/1st_00_introduction
- With GraphQL id: https://<your-site>.netlify.app/?id=Q291cnNlOjM4Mw==

STEP 5 — Register a test contact
On the event page, fill the form and submit.
If the email doesn't exist yet, we will create a Contact under DEFAULT_ACCOUNT_ID and register it to the event.

COMMON GOTCHAS
- "Deploy directory 'public' does not exist": You uploaded the wrong thing.
  Make sure /public is at the top level in GitHub (not nested inside another folder).
- "Missing ADMINISTRATE_...": You didn't add or deploy env vars. Add them, then Clear cache and deploy.
- Token format: ADMINISTRATE_API_TOKEN must be the raw token ONLY (no "Bearer " prefix).
- Changing env vars? Always Clear cache and deploy.

You're done! Paste a real event code or legacyId if you want me to test your exact URL.
