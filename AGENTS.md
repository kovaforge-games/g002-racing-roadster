# AGENTS.md

## GOLDEN RULE: Cloudflare free plan only

This rule comes from Mike (24 Oct 2026) and overrides everything else in this repo.

- Every game in kovaforge-games must use only Cloudflare free-plan features. No Workers Paid, no paid add-ons, nothing that can produce a bill. Mike has no budget for this.
- Prefer features that hard-stop at the free limits rather than charging for overage.
- Any Workers AI call or other quota-spending call must be capped, rate-limited, or replaced with pre-recorded or static assets.
- Keep `workers_dev` set to `false` in wrangler config.
- Never commit tokens or secrets. Deploys use the org secret `CLOUDFLARE_API_TOKEN`.
- Any change that might need a paid plan must be raised with Mike first. The default answer is no.

Full detail: [FREE-PLAN.md](FREE-PLAN.md).

## Working in this repo

- Read FREE-PLAN.md before adding any Cloudflare binding, product or dependency.
- If you are unsure whether something is free, treat it as paid and ask Mike.
