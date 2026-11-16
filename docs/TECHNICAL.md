# Woodworking Material Optimizer: technical documentation

This is the full reference. It was written by Claude (Fable 5.2) as part of the
build, so the "I" in it is the model. For the problem, my reasons and the
results, see the [project README](../README.md).

Works out how to cut a list of cabinet panels from sheets of plywood (or any
sheet goods) using as few sheets as possible, and tells you the order to make
the cuts in. It runs in your browser. There is no server, you don't need an
account, and it doesn't cost anything.

## Run it

To use the app you don't need to install anything.

- Open the hosted copy: <https://matthewregerman.github.io/woodworking-material-optimizer/>
- Or double-click `cabinet-optimizer.html`. It is the whole app in one file and
  works with no internet connection.

The app opens with a realistic example job (three kitchen base cabinets in four
materials). Press **Calculate cutting plan** to see it work. "Project Files ▾" has
*New empty job*, *Load the example job*, *Open a job file* and *Save job and
plan to a file*; the printer button beside it prints the plan.

The job, its plan and the ticked-off cuts are saved in the browser you are
using, after every change. To move a job to another browser or device, save it
to a file (see "Job files" below).

### For developers

Node.js 18 or newer is needed only for the tests and the build.

`index.html` loads its scripts as ES modules, and browsers refuse to load
modules from a double-clicked file. Serve the folder over HTTP instead:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173`. Any static file server does the same job.
`.claude/launch.json` starts this one. After changing anything under `src/`,
`index.html` or `styles.css`, regenerate the one-file version with
`npm install && npm run build`.

## Tests

```bash
npm test
```

95 tests, about a minute (46 seconds on my last full run; an earlier run took
over 3 minutes while other programs were busy). Most of the time is the
random-job and exhaustive-solver tests. See "How it was tested" below.

## What you enter

**Saw & settings**

| Setting | Meaning |
| --- | --- |
| Units | Millimetres or inches. Inches accept fractions (`23 1/2`, `3/4`). Switching converts what is already entered. |
| Saw kerf | Width of the slot the blade cuts. Every cut loses this much. |
| Edge trim | Taken off all four edges of every sheet before anything is laid out, for damaged or out-of-square factory edges. 0 = use the factory edges. |
| Edge banding thickness *(more options)* | If your banding is thick (e.g. 2 mm), cut sizes are reduced by this much per banded edge so the finished size comes out right. Leave 0 for thin iron-on tape. |
| Smallest offcut worth keeping *(more options)* | Leftovers narrower than this count as waste instead of offcuts. |
| After using as few sheets as possible, prefer | **Large offcuts** (the default) or **Fewer cuts**. See "Large offcuts or fewer cuts" below. |
| First cuts on a full sheet *(more options)* | No preference, rip first (table saw friendly) or crosscut first (easier to handle). |

**Stock sheets** — material (free text), thickness, length, width, which way the
grain runs (along length / along width / no grain), good faces (both, or one
good face + a back), how many you have (blank = as many as needed), and an
optional price.

**Panels** — name, finished length and width, quantity, material (picked from
your stock sheets), grain (must run along the panel's length, along its width,
or either way), faces seen (one, both, or hidden), and how many long edges and
ends get edge banding.

## What you get back

- **Summary** — sheets used, percentage of the stock that becomes parts,
  reusable offcut area, number of cuts and metres of sawing, cost, a per-material
  table saying whether the sheet count is provably the fewest possible, the
  number of cuts on every sheet and in total, a shopping list, and the total
  length of edge banding. When the plan favours fewer cuts it also shows, side
  by side, what favouring large offcuts would have given (cuts, metres of
  sawing, offcuts).
- **A to-scale drawing of every sheet** — parts labelled with name and cut size,
  offcuts with their sizes, waste hatched, every cut drawn kerf-wide and
  numbered, grain direction marked.
- **The cutting order for each sheet** — a numbered list of edge-to-edge cuts.
  Each step says which piece to pick up, whether it is a rip or a crosscut, the
  measurement to set, how long the cut is, and exactly what the two resulting
  pieces are (a finished panel, a piece that goes on to cut *n*, an offcut, or
  waste). Step through with ◀ ▶, tick cuts off as you make them (remembered),
  or tap a part / cut number on the drawing. On a phone the drawing zooms in on
  the piece being cut.
- **Cut list** — every panel with quantity, cut size, finished size (when
  banding thickness changes it), grain, faces, banded edges and which sheets it
  is on.
- **Print** — the printer button in the header prints the summary, then each
  sheet starting on a new page with its drawing and a check-box list of its
  cuts, then the cut list. See "Printing" below.

### How to read a cut

> **Cut 5 — Rip at 560 mm.** Take the 720 × 646.8 piece from cut 4. Measure
> 560 mm along its 646.8 mm side and cut straight across — a 720 mm long cut.
> → Cabinet side 720 × 560 — finished → 720 × 83.6 waste

- The measurement is the size of the part you **keep on the measured side** —
  set the fence to it, or mark it and put the blade on the far side of the
  line. The kerf always comes out of the other part.
- Every size shown for a leftover piece already has the kerf subtracted, so you
  can check your work with a tape as you go.
- "Rip" means along the grain (or along the sheet's long side if the material
  has no grain); "crosscut" means across it. This follows the sheet, not the
  shape of the piece in your hands.
- With edge trim on, the first two cuts on each sheet clean one long edge and
  one end. Everything after is measured from those two fresh edges. The far
  edges are only trimmed where a part actually reaches them. (When favouring
  fewer cuts, a far edge that two or more parts end on is trimmed once, up
  front, instead of once per part.)

## The rules it guarantees

Every plan is checked after it is made by a separate piece of code
(`src/engine/verify.js`) that shares nothing with the optimizer. If the check
ever failed, the app would show a red "do not cut from this plan" banner.

- No two parts overlap; any two parts are at least a kerf apart.
- Every part is inside the sheet, clear of the edge trim.
- Every part is on a sheet of its own material and thickness.
- A part seen on both faces is only cut from a sheet with two good faces.
- A part with a grain direction is never turned against it.
- Every panel appears exactly as many times as asked (or, if you run out of
  limited stock, the shortfall is listed — never silently dropped).
- Replaying the cut list on a model of the sheet — each cut straight across one
  existing piece, removing a kerf-wide strip — produces exactly the parts in
  the drawing. So the plan can really be cut on a table saw or with a track saw.
- No more sheets are used than you said you have.

## Design decisions (and why)

**Stack.** Plain HTML/CSS/JavaScript modules with no framework and no runtime
dependencies, and Node's built-in test runner. Nothing to install or keep
updated, and it will still run in ten years. `esbuild` is a dev-only dependency
used to produce the single-file version.

**No server.** The app is static files: the hosted copy on GitHub Pages and the
one-file `cabinet-optimizer.html`. An earlier version had a small Node server
that copied the job to a file so a phone on the same Wi-Fi could open it. It
is gone. Nobody needs Node to use the app, and a job now moves between devices
as a job file. npm is only for the tests and the build. For local development
I use `python3 -m http.server`, because it comes with macOS and most Linux
systems and adds no dependency to the project.

**Guillotine cuts only.** Every layout is built from straight edge-to-edge
cuts, because that is what a table saw or track saw can do. Layouts that would
need a stopped or L-shaped cut are never produced, even where they would save
material.

**What "best" means,** in this order: (1) place every part, (2) fewest sheets,
(3) least stock area when sheets come in several sizes, and then whichever you
chose on the job: (4a) **large offcuts** — leftover gathered into the largest
possible pieces rather than scattered slivers — or (4b) **fewer cuts**, with
offcut size as the tie-break. Price is reported but not optimized — you asked
for fewest sheets first.

**How it searches.** Parts are dropped one at a time into free rectangles,
each of which is then split by a straight cut; the result is a tree of cuts.
The search tries hundreds of orderings and placement rules, improves the best
by simulated annealing, also tries filling one sheet at a time as full as
possible, then repacks pairs of sheets and tries to empty the least-used sheet
piece by piece. It is seeded, so the same job always gives the same plan
(unless the 6-second time cap cuts a very large job short on a slow device).

**Exact arithmetic.** Sizes are stored in millimetres and the engine works in
whole micrometres, so there is no rounding drift in kerf sums, and inch
fractions down to 1/64 are exact to well under a thousandth of a millimetre.

**Faces.** A sheet has two good faces or one. A panel seen on both faces needs
a two-good-face sheet; anything else can come from either. On a one-good-face
sheet every part automatically has its good face on the same side, so the
"cut accordingly" part is: you cannot flip a part over to make it fit, and the
plan tells you which way up to lay the sheet for your saw (good face up on a
table saw, down under a circular or track saw).

**Grain.** The sheet's *Length* is the grain direction unless you choose
otherwise. A panel's grain setting fixes which way it may lie; "either way"
lets the optimizer turn it. If a sheet has no grain, everything may turn.

**Material matching** ignores capitalisation and extra spaces, so "Birch
Plywood" and "birch plywood " are the same material. Panels pick their material
from a list built from your stock sheets, so they cannot be mistyped.

**Edge trim** is the total removed per edge including the blade. Only the two
reference edges are always trimmed; a far edge is trimmed only where a part
reaches it, which saves cuts. In fewer-cuts mode, a far edge that several parts
end on is trimmed in one pass instead.

**Edge banding** is counted per panel as number of long edges and number of
ends. With a banding thickness set, cut length is reduced by the banded ends
and cut width by the banded long edges.

**Bad input.** Problems are shown on the row and field they belong to, in
plain words, with a list you can click to jump to each one. Completely empty
rows are ignored. Errors block calculating (a plan that silently left parts out
would be worse than no plan); oddities such as a zero quantity or grain set
along the short side are warnings and do not block. A panel that cannot fit
says why: too big, only fits against the grain, or needs a two-face sheet.

**Running out of stock.** If you limit how many sheets you have and it is not
enough, you still get a plan for what fits, with a red banner listing exactly
which parts are missing.

**Where the job is saved.** The job, its plan and the ticked-off cuts are kept
in the browser's own storage (`localStorage`) and written after every change.
The line at the bottom of the page says "Saved in this browser". Storage
belongs to one browser on one device and one address, so the hosted copy, the
one-file version and a local development copy each keep their own job. If the
browser refuses to store anything (some private windows, or storage turned
off), the line changes to say the job is not saved and points to Project
Files, where it can be saved to a file.

**One job at a time.** Use *Save job and plan to a file* and *Open a job file*
to keep several. See "Job files" below.

## Large offcuts or fewer cuts

Under **Saw & settings** you choose what the optimizer favours once the sheet
count is as low as it can get:

- **Large offcuts** (default, and exactly what the app did before this option
  existed). Leftover is gathered into the biggest pieces possible. This can
  cost cuts: to keep a big offcut whole, small parts get packed tightly
  elsewhere, each needing its own two cuts.
- **Fewer cuts.** Fewer cuts to measure and make. Leftover may end up in
  smaller pieces, or spread over more of the sheets you were using anyway.

### What it promises

Fewer-cuts mode never uses more sheets, never uses more stock area, and never
leaves out more parts than large-offcuts mode does on the same job. It also
never takes *more* cuts. These are not tendencies; they hold by construction
(see below) and are tested on every plan in the test suite.

### What counts as a cut

A cut is one step in the cutting order: one pass of the saw, edge to edge,
across one piece — trim cuts included. It is the same number shown on the
drawings and in the step list, so what is minimised is exactly what you count
at the saw. (A test checks that the number the search minimises equals the
number of steps produced, sheet by sheet.) Total metres of sawing is shown but
not minimised: fewer, longer cuts can add up to slightly more sawing, and the
comparison table shows it when that happens.

### Where cuts are saved

Cutting one part out of a bigger piece normally takes two cuts, one for its
width and one for its length. A cut is saved whenever a part is exactly as
wide or as long as the piece it comes from. So fewer cuts means lining parts
of equal size up in strips: rip one strip to width and every crosscut then
frees a finished part. Eight 100 mm frame pieces cut from one 100 mm strip
take about nine cuts; scattered around a sheet they take sixteen.

### How it searches

1. The normal large-offcuts solve runs first, unchanged. Its result is the
   **ceiling**: its sheet count, stock area and number of placed parts.
2. A second whole-job search runs with an objective that counts cuts, and with
   one extra placement rule ("put the part where it fits a side exactly"). Its
   result is kept only if it is within the ceiling.
3. For each of those two layouts, every sheet is re-packed on its own for
   fewer cuts, and then pairs of sheets are pooled and re-packed so that parts
   of the same size can move onto the same sheet. A re-pack is accepted only
   if everything still fits on the same sheets and the cut count drops.
4. With edge trim on, a far edge that two or more parts end on is trimmed once
   for the whole sheet instead of once per part.
5. The layout with the fewest cuts wins; ties go to the better offcuts. If
   nothing beats the ceiling layout, that layout is returned as it is.

Because step 1 is the ordinary solve and nothing is accepted that is worse
than it on sheets, stock or placed parts, the promises above cannot be broken
by a bad search — the worst case is "no cuts saved".

Why not simply add "cuts" to the normal objective? Because sheet count is
found by a search that leans on offcut quality to push material off the
emptiest sheet; mixing cuts into it could occasionally cost a sheet. Running
the proven solve first and treating it as a ceiling keeps the two concerns
apart.

### What it costs

- **Time:** about twice as long, since it does the normal solve and then the
  cut search (under a second for the kitchen job and the example; up to a
  few seconds for jobs with 50+ pieces on many sheets).
- **Offcuts:** the big clean offcut can go. On the kitchen job below, large
  offcuts leaves a nearly whole 2335 × 1219 sheet of birch; fewer cuts leaves
  a 2438 × 586 strip and smaller pieces instead.

### Measured

| Job | Sheets (both modes) | Cuts, large offcuts | Cuts, fewer cuts |
| --- | --- | --- | --- |
| Kitchen cabinets and frame — 36 pieces, 3 laminate + 2 birch sheets | 5 | 61 | 54 |
| Built-in example — 44 pieces, 4 materials, 4 mm kerf, no edge trim | 5 | 67 | 61 |
| Stair cabinets — 12 pieces, 1 sheet | 1 | 17 | 17 |
| 20 random cabinet-style jobs — 711 pieces | 148 | 1346 | 1212 |

For reference, CutList Optimizer cut the kitchen job from the same 5 sheets in
55 cuts and the stair job in 17. The plan shows the comparison itself: in
fewer-cuts mode the summary lists both modes' cuts, sawing and offcuts side by
side, because the large-offcuts layout has already been worked out on the way.

### Saved jobs

Jobs and plans saved before this option existed load as "large offcuts" and
their saved plan still counts as up to date. The setting is stored in the job
(and in job files); switching it marks the plan out of date until you
recalculate.

## Job files

*Save job and plan to a file* downloads a `.json` file. *Open a job file* loads
one, on a computer or a phone. This is how you keep several jobs, back one up,
or move one to another device.

The file holds the job (the stock, the panels and the settings) and, when the
plan is up to date with the job, the plan and which cuts you have ticked off. The
job part is laid out over many lines so it can be read and edited by hand. The
plan is written on one line to keep the file small. The example kitchen job with
its plan is about 42 KB, and the job alone is about 7 KB.

When you open a file, the plan is kept only if all of these hold:

- it was made by this version of the optimizer;
- it matches the job in the file;
- its panel and stock lists match the job, and it passes the independent checker
  again (the same one every new plan goes through).

The "passed" result stored in the file is ignored and worked out again, so a file
cannot carry its own pass. If any of these fail, you get the job with no plan, a
message says so, and you press Calculate again. A file with no plan, a file from
before plans were saved, and a bare job all still open.

The checker covers where every part sits and every cut. The summary numbers
(sheet counts, percentages, totals) are read from the file as they are, not worked
out again, so a hand-edited summary would show wrong figures. The drawing and the
cut list would still be right.

Saving always downloads a copy. The page does not overwrite the file you opened.
Browsers other than desktop Chrome and Edge cannot do that, and no phone browser
can, so I did not build it for one browser only.

The format is in `toJobFile`, `jobFileText` and `fromJobFile` in
`src/ui/store.js`, and is tested in `test/jobfile.test.js`.

## Printing

The rules for paper:

- Each sheet starts on a new page. Its heading and drawing stay together in
  one piece. A page break never runs through a drawing.
- A drawing that would be taller than the page is scaled down to fit. This
  happens with square sheets on landscape paper.
- A long list of cuts runs onto more pages. A page break falls between two
  cuts, never inside one.
- Rows of the summary tables and the cut list are not split. A table that runs
  onto a second page repeats its header.

How it does this:

- When printing starts, every drawing is redrawn for paper: the whole sheet,
  long side across the page, every cut numbered, no cut highlighted. The
  screen drawing comes back afterwards. This is why a plan printed from a
  phone, where the screen drawing is turned on its side, prints the same as
  one printed from a computer.
- The paper drawing is laid out 640 px wide, which is narrower than any common
  page. The page then scales it up to its own width, so the labels and cut
  numbers print larger than they were laid out. A square sheet on landscape
  Letter is the tightest case and comes out at about 0.9 of the laid-out size,
  with 13 px labels printing at about 9 pt.
- The height limit is the page height minus 1.5 inches for the sheet's
  heading. The page size comes from the print dialog, so it follows the paper,
  orientation and margins chosen there.
- On portrait paper the cuts are listed in two columns under the drawing. On
  landscape paper the drawing takes the left 64% of the page, the cuts run
  down the right of it and then three across underneath.
- The list of cuts prints in a smaller type (8.5 pt) than on screen, so that a
  sheet with up to about 14 cuts fits on one portrait page with its drawing.
- Printing from the Job tab prints the plan too.

What I checked: Chrome 157, printing to PDF, at Letter and A4, portrait and
landscape, for the example kitchen job (5 sheets, one of them square), a
one-sheet job with 10 cuts, and a two-sheet job with 82 and 109 cuts. I also
printed the example from a 375 px wide window, from the Job tab, and from the
one-file version. I looked at every page. Safari and Firefox were not checked.
A sheet with 70 or more parts is hard to read at page size whatever the
layout, because the parts themselves are small.

## Limits and things to know

- **It is a heuristic, not a proof.** "✓ fewest possible" is only shown when
  the sheet count equals what the parts' total area needs, which is a hard
  floor. When the shapes force more sheets than the area alone would, the app
  says so honestly ("no layout found with fewer") rather than claiming optimal.
- **How good is it?** On 150 small random jobs it matched an exhaustive search
  every time. Sheets cut into 8–16 random pieces are reassembled at 100% fill.
  On deliberately brutal multi-sheet puzzles (random pieces that fill every
  sheet 92–95%), it found the known best sheet count in roughly 8 cases out of 10
  and was one sheet over in the rest (never more). Ordinary cabinet jobs are far looser than
  that.
- **Rip / crosscut wording follows the sheet's grain,** so trimming a narrow
  strip to length can be called a rip. The measurement, the cut length and the
  drawing make clear which way the cut goes.
- **The saved job lives in one browser.** Clearing that browser's site data
  removes it. Save a job file for anything you want to keep.
- **Fewer cuts is a search too.** It finds layouts with fewer cuts, not
  provably the fewest. On a job where it finds nothing better it hands back the
  large-offcuts plan and says so.
- Identical sheets are listed separately rather than "cut 2 of these".
- No dark mode. Light theme only, for a bright shop.
- Largest job: 1,500 pieces.

## How it was tested

Automated (`npm test`):

- `test/rules.test.js` — the correctness rules on hand-made cases with known
  answers: kerf decides whether two parts share a sheet, cut distances include
  the kerf, edge trim, skim cuts, grain, material, faces, limited stock,
  quantities, first-cut preference, inch fractions, repeatability, and that
  parts + offcuts + waste + sawdust add up to the sheet exactly.
- `test/property.test.js` — 300 random jobs (metric and imperial, several
  materials and sheet sizes, limited stock, trim, banding, every grain and face
  setting); every plan must pass the independent verifier.
- `test/verify.test.js` — proves the verifier is not a rubber stamp: a good
  plan is damaged 14 different ways (part moved 1 mm, overlap, wrong size,
  turned against the grain, wrong material, missing part, skipped cut, …) and
  each must be caught.
- `test/quality.test.js` — matches an exhaustive solver on small jobs,
  reassembles cut-up sheets, known-answer multi-sheet jobs, never worse than
  simple shelf packing, leftover is consolidated.
- `test/fewer-cuts.test.js` — the fewer-cuts option: on 100 random jobs plus
  the example and a real 36-piece kitchen job it never uses more sheets, more
  stock or leaves out more parts than the default, never takes more cuts, and
  every plan passes the verifier; the default is unchanged by the option; the
  cut count the search minimises equals the number of steps in the cutting
  order; whole-edge trimming; older saved jobs load with the old behaviour.
- `test/model.test.js` — bad input is rejected with the right message on the
  right field.
- `test/units.test.js`, `test/text.test.js` — parsing/formatting of lengths and
  the wording of cuts.

By hand, in a real browser, at desktop (1280 px) and phone (375 px) widths:
loading the example, calculating, stepping through cuts, ticking them off,
tapping parts and cut numbers, invalid input of several kinds, inches, running
out of stock, the menu and replace-job dialog, reload persistence, saving a
job file and opening it again, printing to PDF (see "Printing"), the
single-file version opened straight from disk, and switching
between large offcuts and fewer cuts (the plan goes "out of date", recalculating
redraws every sheet and its cutting order, and a job saved before the option
existed opens with its plan still current).

## Files

```
index.html, styles.css      the page
src/engine/                 the optimizer (no browser code; usable from Node)
  units.js                  parsing and formatting lengths
  model.js                  validating a job and turning it into a problem
  packer.js                 the layout search
  cuts.js                   layout -> physical cut sequence
  verify.js                 independent checker
  optimize.js               ties it together
  example.js                the example job
src/ui/                     the interface
scripts/build-standalone.js builds cabinet-optimizer.html
cabinet-optimizer.html      the single-file version
test/                       automated tests
```
