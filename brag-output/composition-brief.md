# Hyperframes Composition Brief: InboxCA

## Objective
Create a short launch-style brag video for InboxCA, with narration.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: vertical, 1080x1920
- Duration: 24.5 seconds

## Source Material
- Project root: `Paresh CA Automation/`
- Primary files read: `PLAN.md` (product behaviour, folder and file naming rules), `InboxCA-Brand-Kit.png` (logo, colours, type, brand line, product chips), `Orelu-CA-Firms-Plan.pptx` (plain-language product lines), project memory (brand decisions).
- Product name: InboxCA, a product by Orelu
- Tagline / strongest claim: "Nothing pending." and "Less chasing. More doing."
- Key UI or visual moment to recreate: an InboxCA window handling one client's email end to end; the unread counter falling to 0.
- Copy that must appear verbatim:
  - Nothing pending.
  - Less chasing. More doing.
  - Ready for your approval
  - A product by Orelu
- No web address (no domain is held yet). No statistics. No claim that the product is live.

## Creative Direction
- Tone preset: default
- Creative direction: reels-style POV hook, word-by-word captions synced to the voice, micro-demo, brand-line payoff.
- Interpretation: fast in, then hold; professional navy and white; no rounded fonts; no hype words.
- Angle: a CA's worst week, solved in 24 seconds, on one fictional client.
- Hook: "POV: you run a CA firm" over an inbox racing from 12 to 248 unread.
- Outro / punchline: counter falls to 0, "Nothing pending.", then logo and "Less chasing. More doing."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Any figure about time saved; any real client or person name

## Visual Identity
- Background: #0B1F3A
- Text: #FFFFFF on navy, #0B1F3A on white
- Accent: #1A4BB0; tint #C2D3F7; slate #51607A; cool grey #F2F5F9; green #12905F for "done" only
- Display font: Plus Jakarta Sans 800 (local woff2)
- Body font: Plus Jakarta Sans 500 and 700; IBM Plex Mono 500 for dates, times and figures
- Visual references from the project: tray-and-tick mark, ruled ledger lines with one margin line, status chips, "Illustration · sample data" label

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook: 4.1s: POV pill, caption, inbox filling, unread 12 → 248
2. Reveal: 2.7s: logo lands, tick draws, "Meet InboxCA", "AI back office for CA firms"
3. Flow: 11.6s: four steps in one window: reads, saves, reminds, approves
4. Payoff: 2.2s: counter 248 → 0, "Nothing pending."
5. Outro: 3.85s: logo, "Less chasing. More doing.", "A product by Orelu"

## Audio
- Audio role: narration first; low rhythmic bed; sparse UI accents.
- Audio arc: pressure, hit, quiet confirmations, release, sign-off.
- Music: `assets/music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3`
- Music treatment: 0.15 under the voice throughout; fade out over the last second.
- Music cue guidance: bundled preset `assets/music/cues/happy-beats-business-moves-vol-10-by-ende-dot-app.music-cues.json`; strong cues 18.55s and 20.74s; beat grid for the hook emails and step changes.
- Audio-reactive treatment: subtle; bass energy drives the opacity and size of the blue glow behind the content.
- Audio-coupled moments:
  - Hook emails: one per beat
  - Cursor press on Approve: click
  - Counter reaching 0: bell
  - Outro logo: bell
- SFX selection guidance: low high-frequency-risk files; nothing over the voice.
- SFX analysis guidance: `assets/sfx/sfx-analysis.md` read.
- Exact SFX choice: chosen during composition.
- Audio files: copied into `brag-output/composition/assets/`
- Narration: eight Kokoro `af_heart` lines in `assets/vo/l1.wav` to `l8.wav`, each placed at its scene; word timings measured with a local speech recogniser for the captions.

## Hyperframes Instructions
Built with the Hyperframes domain guides (core, animation, creative, keyframes, cli). One standalone composition, one paused GSAP timeline, local fonts and scripts, deterministic (no clocks, no random), `hyperframes check` as the gate.
