Build me an app that works out how to cut a list of cabinet panels from sheets of plywood using the least material possible. Something in the spirit of cutlistoptimizer.com is the idea (inspiration only; don't copy it).

I'm a woodworker about to build cabinets. I'll use it at home and at the saw, so it needs to run locally on my computer (and be usable on a phone), with no accounts or paid services. You own the design and implementation; choose the stack and approach.

## What I'll enter
- My panels: a name, length, width and quantity for each.
- My stock sheets: thickness, dimensions (e.g. 19 mm, 1220 x 2440 mm), and material as free text I type in (no fixed list). Panels must only come from sheets of the matching material and thickness.
- Which faces of the plywood are good (both, or one exterior face and one back face), and which faces of each panel will be seen. Panels that must show a good face have to be cut accordingly.
- My saw kerf (e.g. 1.2 mm).
- Anything else a real cutting job needs that I haven't thought of. Use your judgment (for example grain direction, units, edge trim).

## What I want back
1. A visual layout of the cuts on each sheet, drawn to scale.
2. The dimensions of every piece as cut.
3. A cut list.
4. The order to make the cuts in. It must be something I can follow at a table saw or with a track saw, so every cut goes edge to edge, and the distances account for the kerf.
5. Anything else that would help a woodworker doing this job. Use your judgment.

## What good looks like
- Layouts are correct: nothing overlaps, everything fits, kerf is accounted for, material/face/grain rules are respected, and every piece I asked for appears exactly the number of times I asked.
- Layouts are good: use as few sheets as you can, and then the least waste. Show me how well it did.
- It's clear and pleasant to use, with sensible handling of bad input.
- Include a realistic example cabinet job so I can try it straight away.
- Test it properly, including automated tests of the correctness rules above. Run the app in a real browser, look at it on desktop and phone sizes, and fix what you find.

## How to work
Don't stop to ask me questions or offer to continue. Make reasonable decisions, record them in a README, and finish the whole job. If you hit errors, work through them. You can create files in this folder, install packages and run the app and tests, but don't touch anything outside it.

When you're done, give me a short, plain-language report: how to run it, what it does, the decisions you made, and anything unfinished or that you couldn't verify.
