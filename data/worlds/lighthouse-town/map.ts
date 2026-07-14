export const tiledim = 32;
export const mapwidth = 40;
export const mapheight = 30;
export const tilesetpath = '/ai-town/assets/worlds/lighthouse-town/tileset.svg';
export const tilesetpxw = 256;
export const tilesetpxh = 128;

const layer = (fill: number) =>
  Array.from({ length: mapwidth }, () => Array.from({ length: mapheight }, () => fill));

const ground = layer(0);
const objects = layer(-1);

// Stone paths connect every district to the lighthouse plaza.
for (let x = 1; x < mapwidth - 1; x++) {
  ground[x][14] = 1;
  ground[x][15] = 1;
}
for (let y = 1; y < mapheight - 1; y++) {
  ground[19][y] = 1;
  ground[20][y] = 1;
}
for (let x = 3; x <= 36; x++) {
  ground[x][3] = 1;
  ground[x][26] = 1;
}

// Two canals create the water-town quarters. Four bridges keep the path graph connected.
for (let y = 1; y < mapheight - 1; y++) {
  for (const x of [10, 11, 30, 31]) {
    ground[x][y] = y % 6 === 0 ? 3 : 2;
    objects[x][y] = 2;
  }
}
for (const x of [10, 11, 30, 31]) {
  for (const y of [14, 15]) {
    ground[x][y] = 4;
    objects[x][y] = -1;
  }
}

// A lotus pond and dock occupy the north-east garden.
for (let x = 24; x <= 28; x++) {
  for (let y = 4; y <= 7; y++) {
    ground[x][y] = (x + y) % 3 === 0 ? 3 : 2;
    objects[x][y] = 2;
  }
}
ground[23][6] = 10;
objects[23][6] = -1;
ground[24][6] = 10;
objects[24][6] = -1;

function placeBuilding(x: number, y: number, sign: number) {
  objects[x][y] = 12;
  objects[x + 1][y] = 13;
  objects[x + 2][y] = 14;
  objects[x][y + 1] = 6;
  objects[x + 1][y + 1] = sign;
  objects[x + 2][y + 1] = 7;
}

placeBuilding(3, 18, 18); // 临桥茶馆
placeBuilding(3, 5, 19); // 云溪书院
placeBuilding(34, 18, 20); // 机关工坊
placeBuilding(34, 5, 21); // 水巷民居

// The lighthouse is deliberately inland and faces an open public plaza.
objects[23][10] = 17;
objects[23][11] = 16;
objects[23][12] = 15;
for (let x = 21; x <= 25; x++) {
  for (let y = 13; y <= 16; y++) ground[x][y] = 1;
}
objects[22][16] = 9;
objects[24][16] = 9;

// Trees form a visible boundary; flowers and lanterns decorate the walkable interior.
for (let x = 0; x < mapwidth; x++) {
  objects[x][0] = 8;
  objects[x][mapheight - 1] = 8;
}
for (let y = 0; y < mapheight; y++) {
  objects[0][y] = 8;
  objects[mapwidth - 1][y] = 8;
}
for (const [x, y, tile] of [
  [6, 12, 9],
  [16, 12, 9],
  [33, 12, 9],
  [6, 24, 11],
  [15, 24, 11],
  [27, 24, 11],
  [33, 24, 11],
] as const) {
  objects[x][y] = tile;
}

export const bgtiles = [ground];
export const objmap = [objects];
export const animatedsprites: never[] = [];

export const lighthousePlaza = { x: 22, y: 15 };
export const spawnPoints = [
  { x: 5, y: 12 },
  { x: 15, y: 12 },
  { x: 27, y: 12 },
  { x: 35, y: 12 },
  { x: 5, y: 24 },
  { x: 35, y: 24 },
];
