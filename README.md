# Brandify

Generates a `design.md` brand guide for Tableau Data Apps. Enter a company; Brandify pulls its logo, colors and fonts
from its own website and Simple Icons, measures how that website is actually styled (headless Chromium), lets you edit everything, and exports a
`design.md` that Claude uses to style a data app in that brand's look and feel.

## Where the brand data comes from

Brandify no longer uses Brandfetch's paid Brand API (its credits ran out and don't renew).

- **Name, description, logos:** read from the company's own website (header logo, inline SVG logo, Apple touch icon,
  favicon). A site that blocks automated browsers is read over plain HTTP instead.
- **Official brand color and a clean logo mark:** [Simple Icons](https://simpleicons.org) (CC0 data), matched on the exact
  domain or site name only, so a wrong brand's color is never used. Brands that aren't listed fall through to the next step.
- **Colors otherwise:** read from the logo, then from the website.
- **Look and feel** (corners, shadows, spacing, fonts): measured on the website with headless Chromium.
- **Anything else:** upload a logo or screenshot, or enter the details manually.

Every value is labelled with where it came from. The only remaining Brandfetch use is its free search, which turns a typed
company name into a domain (`BRANDFETCH_CLIENT_ID`); without it, type the domain.

## Run locally

```bash
npm install
npx playwright install chromium
cp .env.example .env     # then fill in your keys
npm run dev              # http://localhost:5173
```

| Variable | Needed for |
|---|---|
| `BRANDFETCH_CLIENT_ID` | Company name search suggestions (optional; without it, type a domain) |
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
heroku config:set BRANDFETCH_CLIENT_ID=... BRANDIFY_AUTH=sso --app <app-name>

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

- Rate limit: 40 expensive requests (brand pulls, site-analysis jobs, reference lookups) per IP per 15 minutes, 60 searches per minute. Job polling is not counted.
- The website analyzer only reaches public internet hosts. `localhost`, private networks and cloud metadata addresses are
  blocked, including for redirects and every sub-request the page makes.
- Domain inputs are validated before they touch the filesystem.
- Optional shared-password HTTP Basic auth (`BRANDIFY_PASSWORD`). In production the server refuses to start with neither
  a password nor `BRANDIFY_AUTH=sso`.
- Chromium runs with `--no-sandbox` in hosted environments (required there), so keep the app inside the internal space.

## Project layout

```
server/        Express API: website identity and analysis (Playwright), optional Claude analysis, security
src/lib/       Color math, synthesis (raw data -> design model), design.md renderer, font helpers
src/           React UI (wizard, live preview)
scripts/       CLI helpers for testing extraction and rendering
```
