# InboxCA

Private home page for InboxCA, a product by Orelu. The product is in development. This repository has no login, billing, database or email service.

## Run locally

```sh
npm ci
npm run dev
```

For the production preview:

```sh
npm run lint
npm run typecheck
npm run build
npm run start
```

Next.js App Router, strict TypeScript, Tailwind CSS, shadcn's Base UI dialog, Lucide and Motion for React. Production uses Next's supported Webpack build. The `/` route is prerendered. Page components use no Node APIs. Cloudflare Workers and OpenNext deployment are future work; nothing has been deployed.

## Files

| Location | Purpose |
| --- | --- |
| `PLAN.md`, `InboxCA-Paresh.pdf`, `Orelu-CA-Firms-Plan.pptx`, `InboxCA-Brand-Kit.png` | Protected planning, business deck, client deck and brand sources |
| `brag-output/` | Original film deliverables and source, preserved separately |
| `reference/` | Original workflow reference, not a running integration |
| `app/(site)/page.tsx` | Static page and section order |
| `components/site/` | Header, original illustrative previews, scroll story, FAQ and invite controls |
| `components/ui/dialog.tsx` | Accessible shadcn dialog primitives |
| `content/` | Source based copy and estimated plans |
| `src/lib/submit-invite.ts` | Validation and the single `submitInvite()` connection point |
| `app/fonts/` | Only the self hosted fonts in use, with SIL licences |
| `public/brand/`, `public/media/` | Only assets the page uses |
| `tests/e2e/`, `scripts/` | Browser checks, audit capture and social image generation |

The previews are original illustrations based on the deck and PLAN. The film is an optional viewing asset; its markup, CSS and animation timelines are not used by the page.

## Two switches

`SITE_PUBLIC` defaults to `false`, even without an env file. It controls robots metadata, `robots.txt` and structured data. Copy `.env.example` to `.env.local` if needed. Rebuild after changing it. Before public use, confirm the domain and mark, and replace the local `metadataBase` in `app/layout.tsx`.

Set `SHOW_PLANS` to `false` in `content/plans.ts` to hide the section and its navigation link. Every price and plan allowance is in that file. These are deck estimates, not a live checkout or pricing engine.

The invite form opens an email draft addressed to `orelu.team@gmail.com`. The visitor must send it. The future endpoint belongs in `submitInvite()`; the page never claims delivery.

## Browser review

```sh
npm run test:e2e
npm run audit:page
npm run brand:social
```

The audit captures top, story and bottom at 390, 768, 1280 and 1920 pixels, in normal and reduced motion modes. It checks axe, overflow, console errors and compressed JavaScript. Review exports go to the operating system temporary directory under `inboxca-review`, or the directory set by `AUDIT_OUTPUT`. They are not committed.

Setup references: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [Tailwind](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [shadcn](https://ui.shadcn.com/docs/installation/next), [Motion's small React API](https://motion.dev/docs/react-use-animate), [OpenNext](https://opennext.js.org/cloudflare/get-started).
