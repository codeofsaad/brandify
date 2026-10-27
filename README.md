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
| `BRANDIFY_PASSWORD` | Required in production; shared password for the whole app |

`npm run dev:alt` runs a second copy on ports 5183/5184 (handy for testing alongside your main one).

## Deploy to Heroku (container)

Brandify needs a real server (headless Chromium + secret API keys), so it can't run inside Tableau. It runs well on Heroku
using the included `Dockerfile` and `heroku.yml`. Use a dyno with at least 1 GB RAM (Standard-2X); Chromium is memory hungry.

```bash
heroku login
heroku create your-brandify-name
heroku stack:set container

heroku config:set \
  BRANDIFY_PASSWORD='choose-a-long-passphrase' \
  BRANDFETCH_API_KEY='...' \
  BRANDFETCH_CLIENT_ID='...'
# optional: heroku config:set ANTHROPIC_API_KEY='...'

git push heroku main        # Brandify must be its own git repo (see below)
heroku ps:type web=standard-2x
heroku open
```

The browser will ask for a password; any username works, the password is `BRANDIFY_PASSWORD`.

In production the server refuses to start without `BRANDIFY_PASSWORD`.

### Built-in protections

- Shared-password HTTP Basic auth on every route.
- Rate limit: 30 pulls/analyses per IP per 15 minutes, 60 searches per minute.
- The website analyzer only reaches public internet hosts. `localhost`, private networks and cloud metadata addresses are
  blocked, including for redirects and every sub-request the page makes.
- Domain inputs are validated before they touch the filesystem.
- Chromium runs with `--no-sandbox` in containers (required there), so keep the password on and don't share the URL widely.

### Notes

- Heroku's disk is ephemeral: screenshots are regenerated on every pull, and nothing is stored between restarts.
- Never commit `.env`. It is in `.gitignore` and `.dockerignore`. Set secrets with `heroku config:set`.

## Project layout

```
server/        Express API: Brandfetch pull, website analysis (Playwright), optional Claude analysis, security
src/lib/       Color math, synthesis (raw data -> design model), design.md renderer, font helpers
src/           React UI (wizard, live preview)
scripts/       CLI helpers for testing extraction and rendering
```
