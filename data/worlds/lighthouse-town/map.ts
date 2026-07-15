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
placeBuilding(14, 5, 24); // 百草铺
placeBuilding(14, 18, 26); // 鱼市货栈
placeBuilding(34, 18, 20); // 机关工坊
placeBuilding(34, 5, 25); // 长明灯笼坊

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
  [2, 2, 27],
  [7, 2, 8],
  [13, 2, 27],
  [17, 2, 8],
  [22, 2, 27],
  [28, 2, 8],
  [33, 2, 27],
  [37, 2, 8],
  [2, 10, 8],
  [7, 10, 27],
  [13, 10, 8],
  [17, 10, 27],
  [27, 10, 8],
  [34, 10, 27],
  [38, 10, 8],
  [6, 12, 9],
  [14, 12, 29],
  [16, 12, 9],
  [27, 12, 29],
  [33, 12, 9],
  [37, 12, 9],
  [6, 17, 9],
  [12, 17, 29],
  [15, 17, 9],
  [29, 17, 29],
  [33, 17, 9],
  [37, 17, 9],
  [2, 22, 8],
  [8, 22, 27],
  [13, 22, 8],
  [6, 24, 11],
  [9, 9, 28],
  [15, 24, 11],
  [18, 22, 27],
  [27, 22, 8],
  [33, 22, 27],
  [38, 22, 8],
  [27, 24, 11],
  [33, 24, 11],
  [37, 24, 28],
  [2, 27, 27],
  [8, 27, 8],
  [13, 27, 27],
  [17, 27, 8],
  [23, 27, 27],
  [28, 27, 8],
  [33, 27, 27],
  [37, 27, 8],
] as const) {
  objects[x][y] = tile;
}

// Walkable flower carpets and courtyard accents break up broad grass areas.
for (const [x, y, tile] of [
  [5, 9, 11],
  [15, 9, 11],
  [21, 7, 1],
  [27, 9, 11],
  [35, 9, 11],
  [4, 12, 11],
  [18, 12, 11],
  [26, 12, 11],
  [36, 12, 11],
  [4, 23, 11],
  [11, 23, 11],
  [16, 23, 11],
  [24, 23, 11],
  [30, 23, 11],
  [36, 23, 11],
] as const) {
  ground[x][y] = tile;
}

// Boats and market details make the canals feel inhabited without changing collision rules.
objects[10][9] = 22;
objects[31][22] = 22;
objects[25][7] = 30;

export const bgtiles = [ground];
export const objmap = [objects];
export const animatedsprites: never[] = [];

export const lighthousePlaza = { x: 22, y: 15 };
export const eventCheckpoints = {
  plaza: { x: 22, y: 15 },
  teahouse: { x: 5, y: 20 },
  academy: { x: 5, y: 7 },
  lotusPond: { x: 27, y: 8 },
  dock: { x: 23, y: 6 },
  workshop: { x: 35, y: 20 },
  herbShop: { x: 15, y: 7 },
  lanternShop: { x: 35, y: 7 },
} as const;

export const townLandmarks = [
  {
    id: 'academy', name: '灯塔书院', icon: '书', x: 4.5, y: 4.45,
    destination: { x: 5, y: 7 }, openHours: '辰时至酉时',
    description: '镇上的教书、抄录与史料整理之所，沈砚常在这里补缀镇志。',
    services: ['识字授课', '镇志查阅', '书信代写'],
  },
  {
    id: 'herb-clinic', name: '白露药庐', icon: '药', x: 15.5, y: 4.45,
    destination: { x: 15, y: 7 }, openHours: '卯时至戌时',
    description: '白露坐诊和配药的药庐，也照看夜航者的旧伤与日常小病。',
    services: ['问诊配药', '旧伤换药', '药草采买'],
  },
  {
    id: 'old-dock', name: '旧水码头', icon: '舟', x: 25.6, y: 7.7,
    destination: { x: 23, y: 6 }, openHours: '全天十二时辰开放',
    description: '摆渡、卸货和交换水路消息的老码头，雾浓时仍有人守夜。',
    services: ['水路摆渡', '货物装卸', '船只停泊'],
  },
  {
    id: 'divination-hall', name: '听潮卦馆', icon: '卦', x: 35.5, y: 4.45,
    destination: { x: 35, y: 7 }, openHours: '巳时至亥时',
    description: '玄微先生经营的卦馆，用节气、观察与问答帮助居民梳理难题。',
    services: ['节气择日', '民俗咨询', '铺面布局'],
  },
  {
    id: 'tea-house', name: '听雨茶庄', icon: '茶', x: 4.5, y: 17.35,
    destination: { x: 5, y: 20 }, openHours: '辰时至子时',
    description: '唐果经营的临河茶庄，是居民吃点心、谈生意和交换消息的地方。',
    services: ['热茶点心', '邻里聚会', '小型商谈'],
  },
  {
    id: 'morning-market', name: '晨雾集市', icon: '市', x: 15.5, y: 17.35,
    destination: { x: 15, y: 20 }, openHours: '卯时至申时',
    description: '鱼货、布匹、灯纸和杂货汇集的早市，也是阿满最熟悉的送货站。',
    services: ['鱼货买卖', '衣料杂货', '临时雇工'],
  },
  {
    id: 'town-office', name: '镇公所', icon: '署', x: 22.5, y: 18.2,
    destination: { x: 22, y: 17 }, openHours: '辰时至酉时',
    description: '办理住民登记、铺面契约与公共事务的镇署，门前也是公告集会处。',
    services: ['住民登记', '契约备案', '公共公告'],
  },
  {
    id: 'workshop', name: '苏氏机关坊', icon: '工', x: 35.5, y: 17.35,
    destination: { x: 35, y: 20 }, openHours: '辰时至戌时',
    description: '苏萤修理船灯、罗盘和小型机关的工坊，顾潮也常来试验新灯。',
    services: ['船灯修理', '机关订制', '工具借用'],
  },
  {
    id: 'restaurant', name: '望潮食肆', icon: '食', x: 7.2, y: 25.1,
    destination: { x: 8, y: 24 }, openHours: '巳时至亥时',
    description: '供应鱼汤面、清粥和时令小菜的食肆，码头收工后最为热闹。',
    services: ['热汤主食', '堂食外带', '工坊送餐'],
  },
] as const;

export type TownLandmark = (typeof townLandmarks)[number];
export type TownLandmarkId = TownLandmark['id'];

export function townLandmarkById(id: TownLandmarkId): TownLandmark {
  return townLandmarks.find((landmark) => landmark.id === id)!;
}

export const spawnPoints = [
  { x: 5, y: 12 },
  { x: 15, y: 12 },
  { x: 27, y: 12 },
  { x: 35, y: 12 },
  { x: 5, y: 24 },
  { x: 15, y: 24 },
  { x: 27, y: 24 },
  { x: 35, y: 24 },
  { x: 22, y: 25 },
];
