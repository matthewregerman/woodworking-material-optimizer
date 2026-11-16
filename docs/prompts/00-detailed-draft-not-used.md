Build a sheet-goods cut optimizer for woodworkers: a local web app that takes a list of cabinet panels plus stock sheet details and works out how to cut them from the fewest sheets with the least waste. Functionally it is in the spirit of cutlistoptimizer.com (you may look at it for inspiration, but do not copy its code, text or branding). I am building cabinets from plywood, and material cost is the thing I most want to minimize.

You have full autonomy over design and implementation. You are the owner and long-term maintainer of this codebase, and its design is up to you.

## Who uses it and how
A hobbyist/pro cabinet builder, on a laptop or phone in the shop, with a table saw or a track saw. They type in a cut list, press one button, and then work from the output at the saw: either printed, or on a screen. The output has to be unambiguous and easy to follow with sawdust on their hands.

## Inputs
1. **Units**: mm or inches (toggle, including fractional-inch entry like `23 1/2`). Store everything internally as integer tenths of a millimetre to avoid floating-point drift.
2. **Stock sheets** (one or more types), each with:
   - Name / material (e.g. "Baltic birch", "3-ply", "MDF", free text)
   - Thickness (e.g. 19 mm)
   - Length x width (e.g. 2440 x 1220 mm)
   - Face finish: which faces are good. Options: good on both faces (e.g. A/A), good on one face only (e.g. A/C, exterior face + back face), or not important
   - Grain direction runs along the length (assume so unless the user changes it)
   - Quantity available (or unlimited) and optional price per sheet
3. **Panels** to cut, each with:
   - Label (e.g. "Left side"), length, width, quantity
   - Which stock type it must come from (material + thickness)
   - Face requirement: show face on one side only, both faces visible, or hidden/don't care
   - Grain: may be rotated 90 degrees, or must keep grain along its length
4. **Saw kerf** (default 1.2 mm), and an **edge trim** per sheet edge (default 0) for cleaning up the factory edges.
5. **Cutting method**, which affects which face goes up: table saw (good face up), circular saw (good face down), or track saw (good face up).
6. Optimization options: guillotine cuts only (default on, because a table saw or track saw can only cut edge to edge), allow rotation, and optimize for "fewest sheets" vs "fewest cuts" vs "largest usable offcut".

Preload an example cabinet job so the app is useful and demonstrable the first time it opens. Validate inputs and give clear messages: for instance a panel larger than any sheet, a panel with no matching stock, or a "good both sides" panel when only single-faced sheets exist.

## Outputs
1. **Visual layout** of every sheet as scalable SVG: each panel drawn to scale in its position, labeled with its name and dimensions, colored consistently by panel type, with waste/offcuts shaded differently. Show kerf accurately. Show grain direction and mark which face is up. Show a legend. One diagram per sheet, with a per-sheet summary (utilization %).
2. **Dimensions** of every piece as placed (length x width, quantity, position on the sheet).
3. **Cut list** table: all panels, with label, size, quantity, which sheet number each one lands on, and whether it was rotated.
4. **Cut order**: a numbered, step-by-step sequence for each sheet that follows real shop practice. Start with full-length rip cuts, then crosscuts, then final trims. Each step says what to do and where: for example "Cut 2: crosscut strip A at 720 mm from the left edge, producing Left side (720 x 580) and offcut (…)". The distances account for kerf, so following the steps produces the right sized pieces. Provide a way to tick steps off as they are done, and highlight the current cut on the sheet diagram. The sequence must be mechanically valid: every cut is a straight edge-to-edge cut of the piece it applies to, with no impossible cuts.
5. **Summary**: sheets needed per stock type, total area used vs wasted, waste %, cost estimate if prices were given, and a list of the reusable offcuts (with dimensions) left over after cutting.
6. **Other helpful features** (use your judgment, but include at least these): print-friendly layout and PDF via the browser's print dialog, CSV export of the cut list, save/load of the whole project as JSON, autosave in the browser, dark mode, and a visible warning whenever the face requirements force extra sheets.

## Optimization requirements
- Panels with different material or thickness are never mixed on one sheet. Solve each stock type separately.
- Respect face requirements correctly. Examples: a "both faces visible" panel can only come from good-both-sides stock. A "one show face" panel on single-faced stock must be placed with the good face on the intended side. If the cutting method wants the good face up, the sheet diagram shows which way up. Be explicit about this logic in the code and the README.
- Respect grain direction, and allow rotation only where permitted.
- Use a proper heuristic or search approach for 2D guillotine bin packing, and try multiple strategies and orderings (and randomized restarts under a short time limit, like 1-3 seconds) before choosing the best result. Never return a layout that is worse than a simple first-fit approach. The optimizer must be deterministic for a given input and seed so results are reproducible, and the UI should offer a "try again" button for a different seed.
- Run the optimizer in a Web Worker so the UI never freezes.
- Handle dozens of panel types and hundreds of pieces without trouble.

## Constraints
- No backend, no accounts, no paid services, no network requests at runtime. It must work offline.
- Runs locally with one command (document it in the README). Your choice of stack, but keep dependencies modest; TypeScript is preferred.
- Responsive: usable on a phone in portrait orientation. The diagrams scale to the screen.
- Accessible: sufficient contrast, keyboard operable, meaningful labels.
- Looks clean and professional: a calm workshop-tool aesthetic with generous spacing, good typography and clear states for empty, loading and error. No generic template look.

## Definition of done
- All inputs and outputs above work end to end with the preloaded example, and with at least two additional example jobs that you create and check (one with mixed materials and face requirements, one large job).
- Automated tests prove the core guarantees on many randomized inputs: no two pieces overlap, every piece lies within its sheet, the gap between adjacent pieces is at least the kerf, every requested piece appears exactly the requested number of times, face and grain rules are never violated, and every cut-order step set reproduces the layout exactly. The tests pass.
- Start the app, drive it in a real browser (screenshot it at desktop and phone widths), and fix anything broken or ugly that you find. There must be no console errors.
- A README explains how to run it, how the face/grain/kerf logic works, and the known limitations.

## Working style
- Do not stop to ask me questions or offer to continue. Make reasonable decisions, record them in the README, and finish the whole task. If you hit errors, timeouts or failing tools, diagnose and work through them.
- You may create files in this folder, install npm packages, and run the dev server, tests and a browser. Don't touch anything outside this folder.

## When finished
Give me a short, plain-language report that a reader who has not seen your work can follow: how to run it, what it does, the decisions you made, how well the optimizer performs, and anything that is unfinished or that you could not verify.
