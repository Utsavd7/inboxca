# InboxCA

Private home page for InboxCA, a product by Orelu, and the product itself, built in small steps tracked in `PLAN.md` (M0). So far the product has its database, background jobs and sign in; it has no billing and sends no real email.

## The product, locally

Local Supabase runs on Docker (on this Mac, through Colima):

```sh
colima start
npx supabase start          # database, sign in and a mail catcher at http://127.0.0.1:54324
npm run db:env              # writes the local connection into .env.local
npm run test:db             # row level security and job tests
npm run build && PORT=3211 npx playwright test tests/e2e/sign-in.spec.ts
```

Sign in is by invitation only, and invites are not built yet: `tests/e2e/sign-in.spec.ts` shows how a person, a firm and their membership are set up before signing in at `/sign-in`. The emailed code arrives in the mail catcher. After a migration, run `npx supabase migration up --local` and `npm run db:types`.

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
| `app/(site)/security/page.tsx`, `content/security.ts` | Security policy page, drafted from PLAN section 8. A lawyer must review it before the site is public |
| `components/site/` | Floating navigation, the clickable demo, the control cards, the plan finder and the invite dialog |
| `components/ui/dialog.tsx` | Accessible shadcn dialog primitives |
| `content/` | Source based copy and estimated plans |
| `src/lib/submit-invite.ts` | Validation and the single `submitInvite()` connection point |
| `app/fonts/` | Only the self hosted fonts in use, with SIL licences |
| `public/brand/` | Only assets the page uses |
| `public/brand/tools/` | Other companies' logos for the "built to work with" row, each the owner's own file, unchanged (Gmail, Outlook, OneDrive, Dropbox and Excel from svgl.app; Zoho Mail, Tally, TaxPower GST and KDK Spectrum from their own sites). Check each brand's usage rules before the site is public |
| `tests/e2e/`, `scripts/` | Browser checks, audit capture and social image generation |

Every screen on the page is an original illustration with sample data, based on PLAN. The page has five parts: a hero with a demo that follows one email through the five jobs, the control cards, plans, questions and a closing invite. The film in `brag-output/` is not used by the page.

## Two switches

`SITE_PUBLIC` defaults to `false`, even without an env file. It controls robots metadata, `robots.txt` and structured data. Copy `.env.example` to `.env.local` if needed. Rebuild after changing it. Before public use, confirm the domain and mark, and replace the local `metadataBase` in `app/layout.tsx`.

Set `SHOW_PLANS` to `false` in `content/plans.ts` to hide the section and its navigation link. Every price and plan allowance is in that file. These are estimates from the business plan, not a live checkout or pricing engine. The estimator asks for clients, kind of practice and team size, and works out the plan and price in the browser with `src/lib/estimate.ts`, Custom included. The formula values (slab rates, rounding, floor) sit in `content/plans.ts` and must be kept in step with the business plan; a test checks them against its worked examples.

The invite form opens an email draft addressed to `orelu.team@gmail.com`. The visitor must send it. The future endpoint belongs in `submitInvite()`; the page never claims delivery.

## Two optional connections

Both are off until their value is set in `.env.local` (see `.env.example`) and the site is rebuilt.

**Invite requests.** With `NEXT_PUBLIC_INVITE_ENDPOINT` empty, the invite form opens a draft in the visitor's own email app. Set it to a web address that accepts a POST and the form sends the answers there as JSON text (`name`, `firm`, `city`, `email`, `clients`, `sentAt`). The page says "We have your request" only when the address replies with a success code; if it does not, the visitor is offered the email draft. A Google Apps Script web app that adds a row to your own Google Sheet is enough:

```js
function doPost(e) {
  const a = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSheet().appendRow([new Date(), a.name, a.firm, a.city, a.email, a.clients]);
  return ContentService.createTextOutput("ok");
}
```

Deploy it as a web app that runs as you and that anyone can reach, and use its address as the endpoint.

**Visit counting.** With `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` empty, the site counts nothing and calls no other server. Set it to a Cloudflare Web Analytics token and the site loads Cloudflare's counter, which uses no cookies. The privacy and security pages change their wording by themselves when it is on. It counts visits and pages, not clicks on the invite button.

## Policy pages

`/security`, `/privacy`, `/terms` and `/refunds` share one layout (`components/site/policy.tsx`); their words are in `content/security.ts` and `content/legal.ts`. They are drafts from PLAN and say that InboxCA is in development. A lawyer must review them before the site is public or takes a payment.

## Browser review

```sh
npm run test:e2e
npm run audit:page
npm run brand:social
```

The audit captures top, control and bottom at 390, 768, 1280 and 1920 pixels, in normal and reduced motion modes. Set `PORT` to run the browser checks beside a server that already uses 3000, for example `PORT=3211 npm run test:e2e`. It checks axe, overflow, console errors and compressed JavaScript. Review exports go to the operating system temporary directory under `inboxca-review`, or the directory set by `AUDIT_OUTPUT`. They are not committed.

Setup references: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [Tailwind](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [shadcn](https://ui.shadcn.com/docs/installation/next), [Motion's small React API](https://motion.dev/docs/react-use-animate), [OpenNext](https://opennext.js.org/cloudflare/get-started).
