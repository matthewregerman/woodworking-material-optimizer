# Test set: my real cabinet jobs

This is two cabinet projects I had already planned in CutList Optimizer. I took the panel lists and stock from the exported plans and ran them through this app with the same sheets and saw kerf.

I compared three things: sheets used (what I buy), number of cuts (how long I'm at the saw), and the share of the stock that ends up as parts (a check that both plans agree).

The old numbers are the totals printed on each export. I read the panel lists out of the exports and checked them against the piece counts and area totals on the exports.

## Job 1: Stair cabinets (small, single sheet)

Stock: 1 sheet, 2438 x 1219 mm. Saw kerf: 4 mm. Pieces could be rotated.
Thickness was not stated in the export, so I treated it as 19 mm plywood.

| Panel | Size (mm) | Qty |
| --- | --- | --- |
| Left Support | 878 x 641 | 1 |
| Right Vertical Support | 763 x 150 | 3 |
| Back support | 483 x 641 | 1 |
| Back support lower | 280 x 150 | 3 |
| Seat Bottom | 397 x 641 | 1 |
| Seat Top | 641 x 388 | 1 |
| Leg Back | 395 x 641 | 1 |
| Leg front | 641 x 413 | 1 |

12 pieces, 2.36 m² of parts.

| | CutList Optimizer | This app |
| --- | --- | --- |
| Sheets | 1 | 1 |
| Cuts | 17 | 17 |
| Share of sheet used for parts | 80% | 80% |

This one is easy, since one sheet is the least possible. It's a sanity check that the app doesn't do worse on a simple job. Its biggest leftover is a 1148 x 413 mm offcut.

## Job 2: Kitchen cabinets and frame (large, mixed materials)

Stock: 3 laminate sheets and 2 sheets of 18 mm birch plywood, all
2438 x 1219 mm. Saw kerf: 3 mm. Pieces could be rotated. Laminate thickness
was not stated in the export, so the app uses a placeholder.

Laminate (17 pieces):

| Panel | Size (mm) | Qty |
| --- | --- | --- |
| Fridge Big | 1241 x 722 | 1 |
| Tallcab Big face | 1521 x 454 | 1 |
| Tallcab Small face | 759 x 454 | 1 |
| Sink Cab Face | 912 x 756 | 1 |
| Fridge Small | 722 x 475 | 1 |
| Fridge Condenser | 722 x 521 | 1 |
| Tall Cab End | 2375 x 630 | 1 |
| CornerCab Face | 759 x 531 | 1 |
| Dishwasher Side | 635 x 876 | 1 |
| Half Fridge divider | 1381 x 641 | 1 |
| SmallCab Face | 759 x 302 | 1 |
| 3Drawer Small | 607 x 124 | 2 |
| 3Drawer Med | 251 x 607 | 2 |
| 3Drawer Large | 378 x 607 | 2 |

18 mm birch plywood (19 pieces):

| Panel | Size (mm) | Qty |
| --- | --- | --- |
| Fridge divider | 2286 x 630 | 1 |
| Shelf Back | 1068 x 235 | 1 |
| Vertical divider frame | 763 x 100 | 8 |
| Horizontal divider frame | 430 x 100 | 8 |
| Right Upper2 | 1222 x 100 | 1 |

36 pieces, 10.6 m² of parts.

| | CutList Optimizer | This app, "large offcuts" | This app, "fewer cuts" |
| --- | --- | --- | --- |
| Sheets | 5 (3 laminate, 2 birch) | 5 (3 laminate, 2 birch) | 5 |
| Cuts | 55 | 61 | 54 |
| Stock used for parts | 71% | 71% | 71% |

### What this showed

The sheet count matched. Three laminate sheets is the least the area allows. The birch parts would fill 93% of one sheet by area, but neither tool found a one-sheet layout, so both use two. I haven't proved that none exists.

The cuts didn't match at first. My first version, which favored big leftover pieces, needed 61 cuts, six more than CutList Optimizer. It put 18 of the 19 birch pieces on one sheet and left almost a whole second sheet as an offcut. That's great if I want to reuse the offcut and worse if I want less time at the saw.

That's why I added the "prefer fewer cuts" setting. With it on, the kitchen takes 54 cuts, one fewer than CutList Optimizer, on the same sheets. The big birch offcut turns into a 2438 x 586 mm strip and some smaller pieces.

The app's own checks (no overlaps, kerf accounted for, every piece placed the right number of times, and the cuts replayed to confirm a table saw can make them) passed on both projects.

## What this test set doesn't show

- It's only two projects, both mine and both ordinary cabinet work. It says the app holds up against a commercial tool on jobs like these, not that it finds the best possible layout.
- I compared sheets and cuts. I haven't timed a real build using the app's cut order.
- The old plans all came from one tool. I didn't compare against others.

The automated tests cover a lot more, including 300 random jobs and a check against an exhaustive solver. See [TECHNICAL.md](TECHNICAL.md).
