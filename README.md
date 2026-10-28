# Brandify

Generates a `design.md` brand guide for Tableau Data Apps. Enter a company; Brandify pulls its logo, colors and fonts
(Brandfetch), measures how its website is actually styled (headless Chromium), lets you edit everything, and exports a
`design.md` that Claude uses to style a data app in that brand's look and feel.

## Run locally

```bash
npm install
npx playwright install chromium
cp .env.example .env     # then fill in your keys
npm run dev              # http://localhost:5173
```

| Variable | Needed for |
|---|---|
| `BRANDFETCH_API_KEY` | Pulling brand data (required for companies outside the 3 built-in demos) |
| `BRANDFETCH_CLIENT_ID` | Company name search suggestions (optional; without it, type a domain) |
| `ANTHROPIC_API_KEY` | Optional "Visual character" screenshot analysis |
| `BRANDIFY_PASSWORD` | Shared password for the whole app (production without SSO) |
| `BRANDIFY_AUTH=sso` | Production only: skip the password because the platform already authenticates users |

`npm run dev:alt` runs a second copy on ports 5183/5184 (handy for testing alongside your main one).

## Deploy to Heroku (Salesforce SE teams)

Follow the "How-To Heroku for Salesforce Sales and SE" canvas. Key rules: every app is owned by a **team**, runs in the
team's **internal Fir space**, is **locked**, and keeps secrets in **config vars**. No personal-space apps. Fir builds
with Cloud Native Buildpacks (no Docker), and the app must bind to IPv6 (`::`), which Brandify does in production.

```bash
heroku login                      # enter sfdc-sso when asked for the org
heroku apps:create <app-name> --space se-amer-reg-internal --team se-amer-reg
heroku apps:lock --app <app-name>

# Secrets: type them yourself, never commit them
heroku config:set BRANDFETCH_API_KEY=... BRANDFETCH_CLIENT_ID=... BRANDIFY_AUTH=sso --app <app-name>
# Optional: heroku config:set ANTHROPIC_API_KEY=... --app <app-name>

heroku git:remote --app <app-name>
git push heroku main              # builds with the Node buildpack (runs `npm run build`)
heroku logs --tail --app <app-name>
```

Open the app at the `*.herokuapp-internal.com` URL (the plain `.herokuapp.com` URL is disabled). Okta SSO signs people in.

### How it runs on Heroku

- `Procfile` starts one web process: `node server/index.mjs`. The same process serves the built React app and the API.
- Heroku drops any request over 30 seconds (H12), so website analysis runs as a background job: the browser calls `POST /api/site/start`, then polls `GET /api/site/job/:id`. Jobs run one at a time in memory.
- Website analysis uses the self-contained Chromium from `@sparticuz/chromium` on Linux, because buildpack dynos have
  no system browser libraries. Locally it uses Playwright's Chromium.
- Heroku's disk is ephemeral: screenshots are regenerated on every pull; nothing persists between restarts.

### Built-in protections

- Rate limit: 40 expensive requests (brand pulls, site-analysis jobs, Claude analysis) per IP per 15 minutes, 60 searches per minute. Job polling is not counted.
- The website analyzer only reaches public internet hosts. `localhost`, private networks and cloud metadata addresses are
  blocked, including for redirects and every sub-request the page makes.
- Domain inputs are validated before they touch the filesystem.
- Optional shared-password HTTP Basic auth (`BRANDIFY_PASSWORD`). In production the server refuses to start with neither
  a password nor `BRANDIFY_AUTH=sso`.
- Chromium runs with `--no-sandbox` in hosted environments (required there), so keep the app inside the internal space.

## Project layout

```
server/        Express API: Brandfetch pull, website analysis (Playwright), optional Claude analysis, security
src/lib/       Color math, synthesis (raw data -> design model), design.md renderer, font helpers
src/           React UI (wizard, live preview)
scripts/       CLI helpers for testing extraction and rendering
```
