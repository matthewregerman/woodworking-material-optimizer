// A realistic starter job: a run of three frameless kitchen base cabinets
// (900 mm two-door, 600 mm three-drawer, 450 mm single-door), 720 high and
// 560 deep, with slab doors and drawer fronts and plywood drawer boxes.
// All sizes in millimetres.

export function exampleJob() {
  const stock = [
    { id: 's1', material: 'Birch plywood', thickness: 19, length: 2440, width: 1220, qty: null, faces: 1, grain: 'length', price: 89 },
    { id: 's2', material: 'Maple veneer plywood', thickness: 19, length: 2440, width: 1220, qty: null, faces: 2, grain: 'length', price: 135 },
    { id: 's3', material: 'Birch plywood', thickness: 6, length: 2440, width: 1220, qty: null, faces: 1, grain: 'length', price: 38 },
    { id: 's4', material: 'Baltic birch', thickness: 12, length: 1525, width: 1525, qty: null, faces: 2, grain: 'length', price: 62 },
  ];
  const P = (name, length, width, qty, stockId, grain, faces, bandL = 0, bandW = 0) =>
    ({ name, length, width, qty, stockId, grain, faces, bandL, bandW });
  const panels = [
    // carcasses — 19 mm birch, inside face seen
    P('Cabinet side', 720, 560, 6, 's1', 'length', 1, 1, 0),
    P('Bottom 900', 862, 560, 1, 's1', 'length', 1, 1, 0),
    P('Bottom 600', 562, 560, 1, 's1', 'length', 1, 1, 0),
    P('Bottom 450', 412, 560, 1, 's1', 'length', 1, 1, 0),
    P('Top stretcher 900', 862, 100, 2, 's1', 'any', 0),
    P('Top stretcher 600', 562, 100, 2, 's1', 'any', 0),
    P('Top stretcher 450', 412, 100, 2, 's1', 'any', 0),
    P('Shelf 900', 860, 520, 1, 's1', 'length', 1, 1, 0),
    P('Shelf 450', 410, 520, 1, 's1', 'length', 1, 1, 0),
    P('Toe kick', 1950, 100, 1, 's1', 'length', 1),
    // show parts — 19 mm maple, both faces seen
    P('End panel', 870, 580, 2, 's2', 'length', 2, 1, 0),
    P('Door', 715, 447, 3, 's2', 'length', 2, 2, 2),
    P('Drawer front, top', 597, 140, 1, 's2', 'width', 2, 2, 2),
    P('Drawer front, deep', 597, 284, 2, 's2', 'width', 2, 2, 2),
    // backs and drawer bottoms — 6 mm birch
    P('Back 900', 720, 880, 1, 's3', 'length', 1),
    P('Back 600', 720, 580, 1, 's3', 'length', 1),
    P('Back 450', 720, 430, 1, 's3', 'length', 1),
    P('Drawer bottom', 524, 438, 3, 's3', 'any', 1),
    // drawer boxes — 12 mm Baltic birch
    P('Drawer side, top', 450, 110, 2, 's4', 'length', 2),
    P('Drawer side, deep', 450, 240, 4, 's4', 'length', 2),
    P('Drawer front/back, top', 512, 110, 2, 's4', 'length', 2),
    P('Drawer front/back, deep', 512, 240, 4, 's4', 'length', 2),
  ].map((p, i) => ({ id: `p${i + 1}`, ...p }));

  return {
    version: 1,
    name: 'Kitchen base cabinets (example)',
    units: 'mm',
    kerf: 4,
    trim: 0,
    bandThickness: 0,
    minOffcut: 100,
    firstCut: 'auto',
    favor: 'offcuts',
    stock,
    panels,
  };
}
