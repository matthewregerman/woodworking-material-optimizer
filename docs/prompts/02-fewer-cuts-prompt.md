Add a "prefer fewer cuts" option to the cut optimizer in this project. Read the README and the existing code first.

## Background
Right now the optimizer's priority order is: place every piece, then fewest sheets, then least stock area, then gather leftover into the largest offcuts. It doesn't try to reduce the number of saw cuts. On one of my real jobs (a kitchen with laminate and birch plywood, 36 pieces) the app used 61 cuts, where CutList Optimizer used 55 for the same sheet count. The extra cuts came from the offcut preference. When I'm at the saw, fewer cuts means less time and fewer measuring errors, so I want to choose.

## What I want
- A setting on the job, where I choose what the optimizer favors after the sheet count: large offcuts (today's behavior, still the default) or fewer cuts. Make the choice clear to someone who isn't an expert.
- It must never use more sheets than the current optimizer finds just to save cuts. Sheet count stays the first priority in both modes.
- Show the total cut count (and per sheet) in the plan summary in both modes, so I can compare them.
- Everything downstream keeps working with no regressions: the drawing, the numbered cut order, the cut list, the verification step, saved jobs (older saved jobs load fine and default to today's behavior), and the print and phone views.
- You own the design: decide how to define "fewer cuts" and how to search for it, and write down your reasoning in the README.

## Definition of done
- All existing tests still pass, and you add tests for the new option, including checks that it never increases sheet count and that every plan still passes the independent verifier.
- Check it against realistic jobs, including a multi-sheet mixed-material job like the kitchen example described above (3 laminate sheets and 2 birch plywood sheets, 36 pieces). Report the cut counts in both modes.
- Run the app in a real browser at desktop and phone widths, switch the option on and off, and make sure the layout and cut order update correctly.

## How to work
Don't stop to ask me questions or offer to continue. Make reasonable decisions, record them in the README, and finish. If you hit errors, work through them. Only touch files in this folder, and don't commit anything. Leave committing to me.

When done, give me a short, plain-language report: what changed, the cut counts before and after on the test jobs, the decisions you made, and anything unverified.
