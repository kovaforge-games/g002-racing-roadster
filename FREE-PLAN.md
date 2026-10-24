# Cloudflare free plan only

Golden rule for every game in the kovaforge-games org. Set by Mike on 24 Oct 2026. Mike has no budget, so nothing in this repo may ever produce a Cloudflare bill.

## What is allowed

- Cloudflare free-plan features only.
- Features that hard-stop when a free limit is reached (requests fail until the daily or monthly reset) are preferred over anything that bills for overage.

## What is not allowed

- Workers Paid or any other paid Cloudflare plan.
- Paid add-ons of any kind, or any product that needs a card on file to use.
- Anything that can generate usage-based charges.

## Quota-spending calls

- Any Workers AI call, or any other call that spends a quota, must be capped, rate-limited, or replaced with pre-recorded or static assets.
- Prefer static assets (pre-recorded audio, pre-written text) over live generation.
- If live calls remain, they need a hard cap and per-client rate limits, and must fail gracefully when the cap is hit.

## Configuration

- Keep `workers_dev` set to `false` in `wrangler.jsonc`, so the game is only reached through kovaforge.org routes and their protections.

## Secrets

- Never commit tokens, keys or secrets.
- Deploys use the org secret `CLOUDFLARE_API_TOKEN` in GitHub Actions.

## Changes that might need a paid plan

- Raise them with Mike before doing anything. The default answer is no.
- If you are unsure whether a feature is free, treat it as paid and ask.
