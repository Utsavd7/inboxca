# Prompt for Codex: build the InboxCA home page

You are building the public home page for **InboxCA, a product by Orelu**: the first page a visitor sees when they open the site. InboxCA is an AI back office for Indian chartered accountant (CA) firms that works from the firm's own email. The product itself is not built yet. This task is the home page only.

Work in two parts. Finish Part A, show me the result, then start Part B.

---

## Before you write anything

Read these, in this order. They are the only sources of truth for facts and copy.

1. `PLAN.md` sections 1, 2, 4.1, 4.2, 9, 9.1 and 11 (what the product is, the stack, the brand, the coding rules). You do not need the rest for this task.
2. `InboxCA-Paresh.pdf` (11 pages). This is the client deck. Almost all the copy for the page is already written there in plain words.
3. `InboxCA-Brand-Kit.png`. The brand board: logo, colours, type, the ruled ledger lines, product chips.
4. `brag-output/composition/index.html`. A finished 30 second product film written as HTML, CSS and GSAP. It already contains the logo as inline SVG, the colour tokens, and working mock screens (inbox, the InboxCA window, checklist, approval card, the "Nothing pending." panel). **Reuse this markup and CSS. Do not redraw these from scratch.**

If a sentence you want to put on the page is not supported by one of these four, do not write it. Add it to a list of open questions at the end of your report.

---

## Part A: housekeeping (do this first)

1. **Rename the project folder** from `Paresh CA Automation` to `inboxca` (same parent folder, `~/Desktop/projects-coding/`). Check nothing inside refers to the old folder name by absolute path; fix it if it does.
2. **Start git** in the renamed folder. Default branch `main`.
3. **Write a `.gitignore`** before the first commit. Keep out everything that is not source or a deliverable:
   - `.DS_Store`, `node_modules/`, `.next/`, `.open-next/`, `.wrangler/`, `out/`, `dist/`, `coverage/`, `*.log`
   - every env file: `.env`, `.env.*` (keep `.env.example` if you create one)
   - `.render/`, `.dist/`, `.claude/settings.local.json`
   - `brag-output/brag-vscode-preview.mp4` (a duplicate of `brag.mp4` for one editor) and `brag-output/composition/snapshots/`
4. **Check for secrets before committing.** Search every file you are about to add for keys, tokens, passwords and private URLs, including `reference/CA_Firm_Automation_n8n_workflow.json`. If you find one, stop and tell me. Never commit a credential.
5. **Create a PRIVATE GitHub repository named `inboxca`** under the account that is logged in to `gh` (run `gh auth status`; it should be the same account that owns `Utsavd7/orelu`). It must be private: the folder holds the business plan, prices and a named client's deck, and the product name is not public yet.
6. **Show me the list of files that will be pushed** (`git status --short` after `git add -A`), then commit and push everything that is left after the ignore rules. Link the local folder to the repository (`origin`) and give me the URL.
7. Do the page work in Part B on a branch named `home-page`, commit in small steps, push, and open a pull request to `main` when it is ready.

---

## Part B: the home page

### What to build

- One page at `/`, inside the product's own app so that the pricing and sign-up pages can join it later.
- Stack as `PLAN.md` section 4.1 says: **Next.js App Router, TypeScript with `strict: true`, Tailwind CSS, shadcn/ui, Lucide icons**. Use the current stable release of each; check the official docs for the current setup commands instead of trusting memory. Keep it deployable to Cloudflare Workers through the OpenNext adapter later (no Node-only APIs in the page, no server needed for it: the page should be fully static).
- Follow the repository layout in section 4.2. Put the page and its parts in a route group such as `app/(site)/` and `components/site/`, so the product app can grow beside it.
- **Do not build any product feature, database, login, payment or email sending.** Do not deploy or publish anything. Add `noindex` to the page behind one switch (`SITE_PUBLIC=false` by default), because the name and logo are not cleared for public use yet.

### Brand (strict)

Use the InboxCA brand in `PLAN.md` section 9.1, not the Orelu tokens in section 9.

- Colours: navy `#0B1F3A`, blue `#1A4BB0`, deep blue `#153E94` for small blue text on light, tint `#C2D3F7`, cool grey `#F2F5F9`, slate `#51607A`, white. Green `#12905F` means "done" and nothing else; use `#0B7A51` behind white text.
- Type: **Plus Jakarta Sans** for words, 800 for headings with tight letter spacing; **IBM Plex Mono** for every date, time, figure and small label. No rounded typefaces. Self-host the fonts with `next/font/local`. Four files are already in `brag-output/composition/assets/fonts/`; add any other weight you need from the same families (both are under the SIL Open Font Licence; put the licence text beside the files).
- Signatures to carry through the page: faint ruled ledger lines with one vertical margin line on navy and blue areas; the blue marker block behind one key word in a headline (see the film); the tray and tick mark.
- Brand line: **Nothing pending.** Tagline: **Less chasing. More doing.**

### Where every asset is

| Asset | Where |
|---|---|
| InboxCA mark as SVG (navy tile and white tile versions) | Inline in `brag-output/composition/index.html` (`<svg class="mark">`, three rect and path elements). It was redrawn from the brand kit: compare it with panel 2 of `InboxCA-Brand-Kit.png` and correct it if it differs. Make it one `Logo` component so it can be swapped in one place. |
| Official InboxCA logo files (PNG) | Company Drive folder "InboxCA brand assets". Not on disk. If I give them to you, use them; otherwise use the SVG above. |
| Wordmark | The word "InboxCA" set in Plus Jakarta Sans 800, navy on light, white on navy, beside the mark. |
| Orelu logos for "A product by Orelu" | `~/Desktop/projects-coding/orelu/dist/assets/orelu.png` (light backgrounds), `orelu-light.png` (dark backgrounds), `mark.png`. Copy what you use into `public/brand/`. |
| Fonts | `brag-output/composition/assets/fonts/` |
| Product film | `brag-output/brag.mp4` (vertical 1080 by 1920, 31.5 seconds, with voice) and its poster `brag-output/brag.jpg` |
| Mock screens, tokens, motion reference | `brag-output/composition/index.html` |
| Copy | `InboxCA-Paresh.pdf` and `PLAN.md` |
| Colours and type reference | `InboxCA-Brand-Kit.png`, `PLAN.md` section 9.1 |

Create `public/brand/` and `public/media/` and copy in only what the page uses. Make an optimised copy of the film for the web (H.264 with AAC, plus a smaller poster in AVIF or WebP); leave the original where it is.

### Copy rules (strict)

- **Plain words a non technical CA would use.** Short sentences. No jargon, no buzzwords, nothing that sounds like an advertisement.
- **No dashes.** No em dashes, no en dashes, no hyphenated joiners where two plain words work. Use full stops, commas and colons.
- **Never invent** a customer, testimonial, logo wall, rating, award, user count, time saving or any number. There are no customers yet.
- **Never say the product is live.** It is in development and the first firms join by invitation. The call to action is "Ask for an invite".
- **Never name a client firm or person** other than the two founders. The deck says "Prepared for CA Paresh": that line and that name must not appear anywhere on the site.
- Do not show a web address for InboxCA (no domain is held yet). Do not write legal pages or link to them; a lawyer will supply them.
- Every screen you draw is a mock. Put the small label "Illustration · sample data" beside each one, as the brand kit does. Client names in mocks stay fictional (the film uses Patel Textiles and D'Souza Exports).
- English only for now. Indian number format (1,23,456). Dates as `10 Oct 2026`.

### Sections, in order

Take the wording from the deck page noted for each. Tighten it if needed, but do not add claims.

1. **Header.** Logo left. Links: How it works, You stay in control, Plans, Coming next, Questions. Button: "Ask for an invite". It stays at the top and becomes compact after the first scroll.
2. **Hero.** Small label "For Indian CA firms". Headline "Less chasing for your CA firm. More doing." One sentence under it: InboxCA is an AI back office that works from your firm's email: it reads every client email, files every paper in the right folder, replies to clients and reminds them only for what is missing. Buttons: "Ask for an invite" and "Watch the 30 second film". Beside or under it, a live mock: an inbox filling up, then being cleared, the unread count rolling from 248 to 0, ending on "Nothing pending." (the film's first and fourth scenes are the reference). Line: "A product by" with the Orelu logo.
3. **Where a firm's time goes today.** Deck page 2: four facts, each with its "With InboxCA" line, and the footnote. These are the only statistics allowed on the page. Keep the footnote's meaning exactly: the figures come from surveys published by Canopy and Karbon, all from outside India, and InboxCA's own time savings have not been measured yet. Link each to its source:
   - https://www.getcanopy.com/blog/document-management-accounting-firm-study/
   - https://www.getcanopy.com/resources/ebooks/canopys-2024-practice-management-survey/
   - https://karbonhq.com/the-karbon-effect/
4. **How it works.** Five steps, the same five as the film: Reads every client email. Files every paper in the right folder (in your own OneDrive or Dropbox). Replies to clients on its own (routine papers go by themselves; private papers wait for one OK from your team). Reminds clients only for what is missing. Keeps forms ready for your approval (your team checks and files; InboxCA never files a return for you). Each step has its mock screen from the film.
5. **What your clients see.** Deck page 5: clients hear from your firm by email, from your firm's own address.
6. **Your whole firm on one screen.** Deck page 6: the dashboard.
7. **You stay in control.** Deck page 7: the eight rows, left column as the title of each card or row, right column as its one line explanation.
8. **Plans.** Deck page 8. Show the plans as estimates before GST, exactly as the deck words them, including the notes under the table. Put every number in **one data file** (for example `content/plans.ts`); no price may be typed inside a component. Add one switch in that file to hide the whole section, because prices may change before the page goes public. Do not build a price calculator.
9. **Coming next.** Deck page 10: the seven future features in the same plain words, with both notes (no passwords; planned for after launch, not in the first version).
10. **Set up yourself.** Deck page 9: the steps, as a simple numbered path.
11. **Questions.** An accordion. Write answers only from `PLAN.md` and the deck. Cover: Do you keep my emails? (no email text is stored) Where are my files kept? (in your own OneDrive or Dropbox) Do you need my GST or income tax portal password or OTP? (never) Does InboxCA file returns? (no, your team files with its own OTP or signature) Does it work with my current software? (it works beside Tally exports and prepares files that TaxPower GST and KDK Spectrum import) Is there WhatsApp? (email only for now) Can I use it today? (in development, first firms by invitation).
12. **Closing and footer.** "Less chasing. More doing." The two founders with their roles as on deck page 11. One "Ask for an invite" button. Footer: "InboxCA, a product by Orelu", the contact email from deck page 11, nothing else.

**The invite button.** There is no backend. Build a small form (name, firm name, city, email, number of clients as a rough range) with proper validation, and route it through one function, `submitInvite()`. Its default behaviour opens the visitor's email app with the answers filled in, addressed to the contact email on deck page 11. Never show a "sent" or "thank you" state that is not true. Leave a clear comment where a real endpoint will be connected later.

### Motion and interaction

The page must feel made this year: smooth, quick and confident. It must not feel like a template, and it must not feel like a toy. Aim for the quality of the best current product sites (Linear, Stripe, Vercel, Raycast are the level), in InboxCA's own calm, professional voice.

- Use **Motion for React** (the `motion` package) for component and scroll animation. GSAP is already used in the film; you may use it for one or two timeline heavy mocks if that is the faster way to reuse the film's code. Do not load both for the same job. Prefer CSS for simple states.
- **Hero mock:** plays once when it enters view, then loops slowly; pause button; it never blocks the headline from showing.
- **How it works:** on desktop, a scroll story. The text for each step scrolls on the left while one product window stays pinned on the right and changes to that step's screen, with a progress rail of five segments (as in the film). On phones, the five steps stack as cards and each mock animates when it comes into view.
- **Headlines:** lines rise in with a short stagger; the blue marker block wipes in behind the key word.
- **Numbers:** roll up or down when they enter view (the 248 to 0 count, the fact figures). Use the mono face.
- **Buttons and cards:** clear hover, press and focus states. A soft spotlight that follows the pointer on cards, only on devices with a fine pointer. Buttons give a small press response. Nothing jumps.
- **Header:** compacts on scroll with a blurred backdrop; the current section's link is marked as you move down the page.
- **Section entrances:** fade and rise once, about 300 to 600 ms, staggered. No element animates twice. No scroll hijacking, no forced smooth scroll library, no parallax that makes text hard to read.
- **Film:** opens in a lightbox when its button is pressed; loads only then; shows the poster first; has controls and captions if you can generate them from the script in `brag-output/brag-plan.md`. Never autoplays with sound.
- **Reduced motion:** when the visitor's system asks for less motion, every animation becomes an instant or a simple fade, and the looping mocks show their final state.
- Animate only `transform` and `opacity` where you can. Hold 60 frames a second on a mid range phone.

### Easy to read for anyone

- Body text at least 18 px on desktop and 17 px on phones, line length 60 to 70 characters, generous spacing.
- One idea per section. A visitor who only reads the headings should still understand the product.
- Design for a 390 px wide phone first, then tablet, then desktop up to 1920 px.
- Accessibility to WCAG 2.2 level AA: real headings in order, landmarks, a skip link, full keyboard use, visible focus, labels on every control, contrast of at least 4.5 to 1 for text, alt text on meaningful images, the accordion and lightbox built on accessible primitives.

### Quality bar (check all of these before you say you are done)

- Lighthouse on a phone profile: Performance, Accessibility, Best Practices and SEO all 95 or higher.
- Largest Contentful Paint under 2.0 s on a simulated 4G phone; Cumulative Layout Shift under 0.05; no layout jump when fonts load (preload the two main font files, `font-display: swap`, size adjusted fallbacks).
- JavaScript sent for this page under about 170 KB compressed. Load the motion heavy mocks only when they near the viewport.
- Images through `next/image` in AVIF or WebP. No third party scripts, trackers, analytics, cookies or font services.
- Title, description, Open Graph and Twitter card tags, a generated social image in the brand, and `SoftwareApplication` structured data without ratings or offers. All of it stays behind the `noindex` switch for now.
- `npm run lint`, type check and build pass with no errors or warnings.
- Run the page in a real browser with Playwright and **look at it**: take screenshots at 390, 768, 1280 and 1920 px wide, of the top, the middle of the scroll story and the bottom, in normal and reduced motion modes. Fix anything that overlaps, overflows, wraps badly or looks empty. Check with an automated accessibility scan (axe) as well.

### What to hand back

1. The pull request link.
2. The screenshots.
3. The Lighthouse numbers.
4. A short list of every line of copy you wrote that is not word for word from the deck, so I can check it.
5. Open questions and anything you could not verify.

If something in this prompt conflicts with `PLAN.md`, follow `PLAN.md` and tell me. If something is unclear, choose the safer option, note it, and keep going.
