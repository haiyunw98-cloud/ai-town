import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, '../public/assets/worlds/lighthouse-town');
mkdirSync(outDir, { recursive: true });

const palette = {
  teal: '#173f43',
  tealLight: '#477b73',
  rice: '#f4ecd8',
  gold: '#e6b85c',
  cinnabar: '#b84a3a',
  roof: '#263f46',
  water: '#77aeb1',
  waterDark: '#4e858d',
  stone: '#b9b3a5',
  grass: '#9fbd7a',
  grassDark: '#75965c',
  wood: '#805442',
};

function tile(index, body) {
  const x = (index % 8) * 32;
  const y = Math.floor(index / 8) * 32;
  return `<g transform="translate(${x} ${y})">${body}</g>`;
}

const tiles = [
  tile(0, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M3 6h3v2H3zm20 7h4v2h-4zM9 25h3v2H9z" fill="${palette.grassDark}"/>`),
  tile(1, `<rect width="32" height="32" fill="${palette.stone}"/><path d="M0 8h32M0 23h32M9 0v8m13 0v15M7 23v9" stroke="#8f8b82" stroke-width="2"/>`),
  tile(2, `<rect width="32" height="32" fill="${palette.water}"/><path d="M2 8h12m5 0h9M7 18h16M1 27h8m7 0h14" stroke="${palette.waterDark}" stroke-width="2"/>`),
  tile(3, `<rect width="32" height="32" fill="${palette.water}"/><path d="M0 9h13m8 0h11M4 25h22" stroke="${palette.waterDark}" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="#789a5a"/><rect x="16" y="12" width="2" height="11" fill="#527345"/><circle cx="19" cy="14" r="3" fill="#d87f8c"/>`),
  tile(4, `<rect width="32" height="32" fill="${palette.water}"/><rect y="7" width="32" height="20" fill="${palette.wood}"/><path d="M0 11h32M0 22h32M8 7v20m16-20v20" stroke="#513a32" stroke-width="2"/>`),
  tile(5, `<rect width="32" height="32" fill="${palette.roof}"/><path d="M0 8h32M0 18h32M4 0v8m8 0v10m8-18v8m8 0v10" stroke="#4f6265" stroke-width="2"/>`),
  tile(6, `<rect width="32" height="32" fill="${palette.rice}"/><path d="M0 25h32M5 4v21m22-17v17" stroke="#b8a987" stroke-width="2"/>`),
  tile(7, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="9" y="7" width="15" height="25" fill="${palette.wood}"/><path d="M12 11h9v8h-9z" fill="#d9bd7b"/><circle cx="21" cy="24" r="2" fill="${palette.gold}"/>`),
  tile(8, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="14" y="18" width="5" height="14" fill="${palette.wood}"/><rect x="8" y="7" width="17" height="16" fill="#426f55"/><rect x="4" y="12" width="24" height="8" fill="#4f805f"/><rect x="11" y="3" width="11" height="8" fill="#5c8c65"/>`),
  tile(9, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="15" y="8" width="3" height="24" fill="${palette.wood}"/><rect x="10" y="7" width="13" height="13" fill="${palette.cinnabar}"/><rect x="13" y="9" width="7" height="8" fill="${palette.gold}"/>`),
  tile(10, `<rect width="32" height="32" fill="${palette.water}"/><path d="M0 24h32M4 7v22m8-22v22m8-22v22m8-22v22" stroke="${palette.wood}" stroke-width="5"/>`),
  tile(11, `<rect width="32" height="32" fill="${palette.grass}"/><circle cx="8" cy="10" r="3" fill="#e7d6db"/><circle cx="16" cy="20" r="3" fill="${palette.cinnabar}"/><circle cx="25" cy="8" r="3" fill="${palette.gold}"/>`),
  tile(12, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M0 25L7 8h25v24H0z" fill="${palette.roof}"/><path d="M5 14h27" stroke="#607174" stroke-width="3"/>`),
  tile(13, `<rect width="32" height="32" fill="${palette.roof}"/><path d="M0 10h32M0 22h32M8 0v10m16 0v12" stroke="#607174" stroke-width="3"/>`),
  tile(14, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M0 8h25l7 17v7H0z" fill="${palette.roof}"/><path d="M0 14h27" stroke="#607174" stroke-width="3"/>`),
  tile(15, `<rect width="32" height="32" fill="${palette.stone}"/><path d="M5 32l4-25h14l4 25z" fill="${palette.rice}" stroke="${palette.teal}" stroke-width="3"/><rect x="13" y="19" width="7" height="13" fill="${palette.wood}"/>`),
  tile(16, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M9 32l2-32h10l2 32z" fill="${palette.rice}" stroke="${palette.teal}" stroke-width="3"/><rect x="14" y="10" width="5" height="7" fill="${palette.waterDark}"/>`),
  tile(17, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M7 25h18l-3 7H10z" fill="${palette.teal}"/><rect x="9" y="13" width="14" height="12" fill="${palette.gold}" stroke="${palette.teal}" stroke-width="3"/><path d="M5 13L16 3l11 10z" fill="${palette.cinnabar}"/>`),
  tile(18, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="5" y="7" width="22" height="18" fill="${palette.cinnabar}"/><path d="M10 11h12v3H10zm0 6h12v3H10z" fill="${palette.gold}"/>`),
  tile(19, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="6" y="5" width="20" height="22" fill="${palette.teal}"/><path d="M10 9h12v3H10zm0 6h12v3H10zm0 6h8v3h-8z" fill="${palette.rice}"/>`),
  tile(20, `<rect width="32" height="32" fill="${palette.rice}"/><circle cx="16" cy="16" r="10" fill="none" stroke="${palette.wood}" stroke-width="4"/><circle cx="16" cy="16" r="3" fill="${palette.cinnabar}"/><path d="M16 3v26M3 16h26M7 7l18 18M25 7L7 25" stroke="${palette.wood}" stroke-width="2"/>`),
  tile(21, `<rect width="32" height="32" fill="${palette.rice}"/><path d="M2 13L16 3l14 10v19H2z" fill="${palette.rice}" stroke="${palette.teal}" stroke-width="3"/><rect x="12" y="19" width="8" height="13" fill="${palette.wood}"/>`),
  tile(22, `<rect width="32" height="32" fill="${palette.water}"/><path d="M3 20h26l-6 8H9z" fill="${palette.wood}"/><rect x="15" y="4" width="2" height="17" fill="#513a32"/><path d="M17 5l10 10H17z" fill="${palette.rice}"/>`),
  tile(23, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M0 22c8-8 24-8 32 0v10H0z" fill="${palette.water}"/><path d="M0 21c9-8 23-8 32 0" fill="none" stroke="${palette.stone}" stroke-width="4"/>`),
];

const tileset = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128" viewBox="0 0 256 128" shape-rendering="crispEdges"><rect width="256" height="128" fill="transparent"/>${tiles.join('')}</svg>`;
writeFileSync(resolve(outDir, 'tileset.svg'), tileset);

const people = [
  ['#315e68', '#d8b28c', '#263f46', '#e6b85c'],
  ['#72504a', '#d2a77d', '#2d2526', '#b84a3a'],
  ['#b84a3a', '#e0b78d', '#3d292a', '#e6b85c'],
  ['#3c6772', '#c9956d', '#202a2d', '#f4ecd8'],
  ['#6b7850', '#ddb18a', '#4a302a', '#e6b85c'],
  ['#8a5743', '#d8a77f', '#39292b', '#91b8ad'],
  ['#4e6f62', '#c98f68', '#1f3337', '#b84a3a'],
  ['#6a5378', '#e0b58d', '#352a3b', '#e6b85c'],
];

function personCell(x, y, direction, frame, colors, index) {
  const [robe, skin, hair, accent] = colors;
  const step = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const face = direction !== 3;
  const side = direction === 1 ? -1 : direction === 2 ? 1 : 0;
  const accessory =
    index === 0
      ? `<rect x="9" y="5" width="14" height="3" fill="${accent}"/>`
      : index === 1
        ? `<rect x="14" y="2" width="4" height="5" fill="${hair}"/>`
        : index === 2
          ? `<rect x="22" y="6" width="4" height="4" fill="${accent}"/>`
          : index === 3
            ? `<path d="M6 8h20l-4-5H10z" fill="${accent}"/>`
            : index === 4
              ? `<rect x="10" y="8" width="12" height="3" fill="${accent}"/>`
              : '';
  const eyes = face
    ? side === 0
      ? `<rect x="12" y="11" width="2" height="2" fill="#302927"/><rect x="19" y="11" width="2" height="2" fill="#302927"/>`
      : `<rect x="${side < 0 ? 11 : 20}" y="11" width="2" height="2" fill="#302927"/>`
    : '';
  return `<g transform="translate(${x} ${y})"><rect x="9" y="28" width="14" height="2" fill="#173f43" opacity=".35"/><rect x="10" y="25" width="5" height="5" fill="#263f46" transform="translate(0 ${step})"/><rect x="18" y="25" width="5" height="5" fill="#263f46" transform="translate(0 ${-step})"/><rect x="8" y="15" width="17" height="12" fill="${robe}"/><rect x="6" y="17" width="3" height="8" fill="${robe}"/><rect x="24" y="17" width="3" height="8" fill="${robe}"/><rect x="9" y="20" width="15" height="3" fill="${accent}"/><rect x="10" y="7" width="13" height="10" fill="${skin}"/><rect x="9" y="5" width="15" height="6" fill="${hair}"/>${eyes}${accessory}</g>`;
}

const personCells = [];
for (let index = 0; index < people.length; index++) {
  const originX = (index % 4) * 96;
  const originY = Math.floor(index / 4) * 128;
  for (let direction = 0; direction < 4; direction++) {
    for (let frame = 0; frame < 3; frame++) {
      personCells.push(
        personCell(originX + frame * 32, originY + direction * 32, direction, frame, people[index], index),
      );
    }
  }
}

const residents = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="256" viewBox="0 0 384 256" shape-rendering="crispEdges">${personCells.join('')}</svg>`;
writeFileSync(resolve(outDir, 'residents.svg'), residents);

console.log(`Generated Lighthouse Town assets in ${outDir}`);
