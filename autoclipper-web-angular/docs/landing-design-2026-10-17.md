# Landing narrative and responsive correction — 2026-10-17

## Direction

Keep the established white/cobalt direction: white #FFFFFF, graphite #202220, surface #F6F6F4, cobalt #2354BB, pink #A32359 and purple #6E3CA3. The existing sans-serif carries controls and explanatory text, with Georgia reserved for the editorial headings. Retain the three-second accent rotation, pause control and reduced-motion support.

The hero shows a podcast source and a portrait composition. The process section is a bounded four-step demonstration: private file and inspection, timestamped transcript, manual vertical framing, and MP4/SRT/VTT output. The studio section uses a caption sheet and saved revision instead of another repetition of the same photograph. Illustrations are explicitly labelled, and the editor link identifies /design/editor as a visual proposal.

## Fix and architecture

The old film strip repeated five copies of a landscape image plus a portrait, with intrinsic height attributes and lazy loading contributing to oversized or blank frames. It has been removed. Each replacement scene is positioned within a fixed aspect ratio, and every media container owns explicit sizing. Scene changes happen through buttons, rather than an observer changing scenes while a mobile reader scrolls through explanatory text.

Landing responsive rules now live in the landing feature with Angular's default style encapsulation. Public header/footer breakpoints live in the public layout. Shared layout and control rules remain in src/styles.css. A paused scene disables its entrance animation entirely, so newly selected content is fully visible instead of frozen at partial opacity.

The availability section describes the previously verified local voice flow: private upload and inspection, Spanish transcription with timed text, manually chosen vertical clip, saved drafts, and MP4/SRT/VTT downloads. It does not present automatic selection, publishing or payments as available. The separate role acceptance remains pending as recorded in local-qa-2026-10-17.md.

## Validation

- npm test: 61 passed.
- npm run typecheck: passed.
- npm run build: passed (existing Node 25 non-LTS warning).
- One final browser pass at 1440×1000 and 390×844; all four scene controls were exercised.
- Desktop content width and scroll width both measured 1425 px. Mobile content width and scroll width both measured 375 px (the 390 px viewport includes the scrollbar).
- At mobile size, each scene measured 316×237 px and had no internal height overflow. Paused scene opacity was 1 with animation name none.
- Local screenshots: C:/Users/USER/Documents/Codex/artifacts/autoclipper-landing-2026-10-17/{desktop,mobile}-{full,process}.jpg. These are local review artifacts, outside Git.

## Generated image provenance

The built-in image generation tool created the new fictional streamer photograph. The project asset is public/images/streamer-studio-v1.webp (960×640, about 40 kB), converted from the generated PNG for delivery. The source PNG remains in the Codex generated-images directory.

Final prompt:

> Use case: photorealistic-natural. Asset type: photography for AutoClipper creator video editing website, studio section. Primary request: an editorial photograph of a fictional young adult Latin American male livestream creator at his home production desk, speaking into a professional boom microphone, wearing over-ear headphones, one hand naturally raised mid explanation. Scene: tactile, credible creator workspace, dark acoustic panels, one monitor showing a soft abstract cobalt video timeline with no readable text, a small camera, subtle blue and mauve practical lights, natural skin texture and expressive face. Landscape 3:2 composition, subject centered with head and hands fully visible, camera at eye level, shot with 50mm lens, calm documentary editorial quality. Restrained cobalt and purple background with warm natural face lighting, realistic materials, no cartoon or CGI. No lettering, captions, logos, watermarks, recognizable real person, no streaming platform branding. This is a new photo, do not replicate any woman or podcast set from previous images.
