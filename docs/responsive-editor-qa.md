# Responsive editor QA

Verified on 23 September 2026. The editor now keeps its main actions accessible
from 320px phones through desktop screens, with touch alternatives for canvas
navigation, element actions and frame stepping.

## Coverage

| Area | Workflows exercised |
| --- | --- |
| Header and project settings | Save, Render, Export, Sign in, compact menus, long names, custom dimensions, frame rate, duration, formats, theme, undo/redo, keyboard shortcuts |
| Account and cloud projects | Sign in/out, save/create/update, open/rename/delete projects, save templates, uploads and deletion |
| Media and properties | Images, video, GIF and audio by URL; stock search and real touch scrolling/pagination; layout, crop/size controls, transforms, fonts, timing, animation, filters, trim, speed, volume and raw JSON |
| Composition | Text, shapes, canvas presets, variables and insertion, scenes, transitions, subtitles and image-layer ordering/replacement |
| Stage | Touch move, resize, rotate, marquee/group movement, snapping, selection actions, duplicate/delete, zoom, Pan mode, all four corners of a zoomed canvas, cancellation and return to editing |
| Timeline | Visual/audio/caption move and trim, animation handles, source/word timing preservation, track changes, scrolling, scrubbing, split, playback, frame stepping, scene navigation, zoom and collapse |
| Design Studio | Text/shape/image layers, properties, animation, preview dragging, canvas/font settings, templates/pagination, insert/update/cancel and walkthrough |
| Dialogs and output | Import errors and successful import, every export tab and JSON download, video/image render options, progress/result and failure recovery, viewport fit and keyboard focus |
| Admin example controls | Long titles, both banner actions, publish confirmation/error/progress/result states, retry controls and Stop editing; local state fixtures only |
| Support | Help access, contact fallback, lazy chat loading, minimize/reopen, late loading, blocked-provider retry and priority for editor dialogs |

The layout sweep covers 1920×1080, 1440×900, 1366×768, 1280×720,
1024×768, 820×1180, 768×1024, 640×800, 414×896, 375×812,
320×640 and 844×390. Feature workflows also use 390×844 and 1440×900.
Tests interact with controls and assert saved/exported project data, not just
element visibility. Screenshots were inspected for phone, tablet and landscape
layouts.

## Defects fixed during testing

- Native touch scrolling interrupted canvas and timeline edits. Gesture targets
  now keep pointer control and clean up on cancellation or unmount.
- Changing timeline tracks could end a held drag early when the clip remounted.
  Track changes now apply on release so movement can continue within the same
  mouse or touch gesture.
- Opening an inspector during touch dragging covered the work area. Taps open
  properties after release; dragging keeps the canvas available.
- Oversized resize hit areas intercepted taps on small text. Hit areas preserve
  a tappable center.
- Right-click actions and keyboard-only frame stepping lacked touch equivalents.
  Element actions and previous/next-frame controls are now visible.
- Zoomed canvases could only be scrolled from narrow gutters. Pan mode allows
  scrolling in both directions without changing the document or selection.
- Upload/design deletion and variable buttons depended on hover. They remain
  accessible on touch screens.
- Variable menus were clipped by inspector scrolling and inherited faded
  styling. They now open within the viewport with independent scrolling,
  dismissal and focus restoration.
- Touch number fields, inspector columns and caption timestamps were cramped.
  Inputs reserve readable space and compact grids wrap appropriately.
- Design Studio gallery selection scrolled the whole modal away from the
  canvas. Selection now scrolls only its gallery; landscape templates also fit.
- Dialog focus could escape to background controls. Dialogs now manage focus,
  support teleported pickers, close with Escape and restore visible triggers.
  Keyboard actions stay inside the dialog so Help cannot edit the canvas behind it.
  WebKit's native Backspace navigation is prevented outside editable controls;
  Backspace still deletes text normally in fields.
- Touch fields now use readable text sizing in portrait, landscape and tablet
  layouts, avoiding the small-input trigger for iOS focus zoom.
- Long admin example names pushed actions outside the screen. The banner wraps
  its action group and truncates the title within available space.
- The support widget could cover Save and Download on phones. Chat now opens
  from Help, hides when minimized or an editor dialog opens, and keeps a contact
  link available when the provider cannot load.

## Validation

- Unit suite: **1,262 passed across 51 files**.
- Combined browser and server regression suite: **329 passed, zero retries**.
- Final Chromium project workflows and layout sweep: **35 passed, zero retries**.
- Firefox project workflows and support checks: **38 passed, zero retries**.
- WebKit project workflows: **30 passed, zero retries**, including phone,
  small-phone and landscape settings, uploads, account, export and render flows.
- Support lifecycle and keyboard checks pass in all three engines. WebKit's
  keyboard case was rerun after correcting native Backspace navigation; the
  focused Chromium support and Design Studio keyboard checks also passed.
- Final isolated responsive editing checks: **71 passed, zero retries**.
- Final timeline follow-up after the track-drag fix: **55 passed, zero retries**
  (35 device gesture tests and 20 existing timeline/snapping tests).
- Final support and Design Studio follow-up: **18 passed, zero retries**.
  A live WebKit phone smoke
  check also opened the real widget, minimized it and downloaded JSON without
  sending a chat message.
- Numeric readability follow-up: **4 passed**. The 320px product tour also
  completed all nine steps with no page errors.
- Type check: **84 existing diagnostics, zero new diagnostics** compared with
  an isolated checkout of Git HEAD. Comparison ignores shifted line numbers and
  preserves duplicate diagnostic counts. The project type check is not clean.
- Production build: **passed**. The local Sentry source-map upload reported a
  Windows TLS credential error; application and Nitro output completed successfully.
- Final whitespace/diff check: **passed**.

These runs overlap; the counts describe each verification run rather than a
sum of distinct tests.

## Reproduce

```sh
npm test
npm run test:e2e -- --retries=0
npx playwright install chromium webkit firefox
npm run test:responsive
npm run build
```

The responsive runner uses Chromium for layout, editing and real touch-input
tests. WebKit and Firefox run project, account, upload, import/export and render
dialog workflows at desktop/tablet/phone sizes. See [tests/README.md](../tests/README.md)
for the local fixture and mock-service setup. Runs sharing the mutable mock
service must be serial; the isolated editing suites use page-local fixtures.

## Verification limits

Screen sizes and touch input are browser-emulated on Windows. Actual iOS and
Android hardware was not available. WebKit testing does not certify native
Safari browser chrome, software keyboards, operating-system file pickers,
codec availability or device GPU performance.

Account and cloud rendering use local mock services. These checks validate the
editor workflow and request/result handling; no real cloud credits were spent
and no examples were published. Admin publish states use isolated fixtures.

Firefox's tab process was blocked by the command sandbox during the initial
attempt. The same blank-page diagnostic succeeded outside that command sandbox;
the browser's own security settings and application code were unchanged.
