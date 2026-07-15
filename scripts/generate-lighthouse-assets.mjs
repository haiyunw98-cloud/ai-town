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
  roof: '#183a42',
  roofLight: '#37616a',
  water: '#4c9b98',
  waterDark: '#286873',
  waterLight: '#9dd3bd',
  stone: '#b9b3a5',
  stoneLight: '#ded5bd',
  grass: '#9fbd7a',
  grassDark: '#75965c',
  grassLight: '#bed58f',
  wood: '#805442',
  shadow: '#102f35',
  blossom: '#e8a2b4',
};

function tile(index, body) {
  const x = (index % 8) * 32;
  const y = Math.floor(index / 8) * 32;
  return `<g transform="translate(${x} ${y})">${body}</g>`;
}

const tiles = [
  tile(0, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M3 6h3v2H3zm20 7h4v2h-4zM9 25h3v2H9z" fill="${palette.grassDark}"/><path d="M13 4h2v2h-2zm13 19h3v2h-3z" fill="${palette.grassLight}"/>`),
  tile(1, `<rect width="32" height="32" fill="${palette.stone}"/><path d="M0 8h32M0 23h32M9 0v8m13 0v15M7 23v9" stroke="#77776f" stroke-width="2"/><path d="M2 3h5m5 10h8m5 14h5" stroke="${palette.stoneLight}" stroke-width="2"/>`),
  tile(2, `<rect width="32" height="32" fill="${palette.water}"/><path d="M2 8h12m5 0h9M7 18h16M1 27h8m7 0h14" stroke="${palette.waterDark}" stroke-width="2"/><path d="M5 5h8m8 9h7M10 24h10" stroke="${palette.waterLight}" stroke-width="1"/>`),
  tile(3, `<rect width="32" height="32" fill="${palette.water}"/><path d="M0 9h13m8 0h11M4 25h22" stroke="${palette.waterDark}" stroke-width="2"/><path d="M2 5h8m13 17h7" stroke="${palette.waterLight}"/><circle cx="17" cy="18" r="7" fill="#638b59"/><circle cx="15" cy="15" r="5" fill="${palette.blossom}"/><circle cx="17" cy="14" r="2" fill="${palette.rice}"/>`),
  tile(4, `<rect width="32" height="32" fill="${palette.water}"/><rect y="7" width="32" height="20" fill="${palette.wood}"/><path d="M0 11h32M0 22h32M8 7v20m16-20v20" stroke="#4b3029" stroke-width="2"/><path d="M0 8h32M0 25h32" stroke="${palette.gold}" stroke-width="1"/>`),
  tile(5, `<rect width="32" height="32" fill="${palette.roof}"/><path d="M0 8h32M0 18h32M4 0v8m8 0v10m8-18v8m8 0v10" stroke="${palette.roofLight}" stroke-width="2"/><path d="M0 29h32" stroke="${palette.shadow}" stroke-width="4"/><path d="M2 4h28" stroke="#5f7d7d"/>`),
  tile(6, `<rect width="32" height="32" fill="${palette.rice}"/><path d="M0 25h32M5 4v21m22-17v17" stroke="#b8a987" stroke-width="2"/><rect x="8" y="8" width="7" height="8" fill="${palette.gold}"/><path d="M9 9h5v6H9z" fill="#ffe6a3"/><rect y="27" width="32" height="5" fill="#6e5545"/>`),
  tile(7, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="9" y="7" width="15" height="25" fill="${palette.wood}"/><path d="M12 11h9v8h-9z" fill="#f0cb74"/><path d="M13 12h7v6h-7z" fill="#ffe9a6"/><circle cx="21" cy="24" r="2" fill="${palette.gold}"/><rect x="3" y="5" width="3" height="20" fill="#b8a987"/>`),
  tile(8, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="14" y="18" width="5" height="14" fill="${palette.wood}"/><rect x="8" y="7" width="17" height="16" fill="#315c4c"/><rect x="4" y="12" width="24" height="8" fill="#47775a"/><rect x="11" y="3" width="11" height="8" fill="#5f9166"/><path d="M7 14h5m9-5h4m-9 10h6" stroke="#78a874" stroke-width="2"/>`),
  tile(9, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="8" y="4" width="17" height="19" fill="${palette.gold}" opacity=".22"/><rect x="15" y="8" width="3" height="24" fill="${palette.wood}"/><rect x="10" y="7" width="13" height="13" fill="${palette.cinnabar}"/><rect x="13" y="9" width="7" height="8" fill="#ffe69a"/><path d="M11 6h11M11 20h11" stroke="${palette.gold}" stroke-width="2"/>`),
  tile(10, `<rect width="32" height="32" fill="${palette.water}"/><path d="M0 24h32M4 7v22m8-22v22m8-22v22m8-22v22" stroke="${palette.wood}" stroke-width="5"/>`),
  tile(11, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M8 10v13m8-3v9m9-21v14" stroke="#537447"/><circle cx="8" cy="10" r="4" fill="#f0d8e0"/><circle cx="16" cy="20" r="4" fill="${palette.cinnabar}"/><circle cx="25" cy="8" r="4" fill="${palette.gold}"/><circle cx="9" cy="9" r="1" fill="white"/>`),
  tile(12, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M0 25L7 8h25v24H0z" fill="${palette.roof}"/><path d="M4 13h28M2 18h30" stroke="${palette.roofLight}" stroke-width="2"/><path d="M0 27h32" stroke="${palette.shadow}" stroke-width="5"/><path d="M6 9h26" stroke="${palette.stoneLight}"/>`),
  tile(13, `<rect width="32" height="32" fill="${palette.roof}"/><path d="M0 9h32M0 20h32M8 0v9m16 0v11" stroke="${palette.roofLight}" stroke-width="2"/><path d="M0 28h32" stroke="${palette.shadow}" stroke-width="6"/><path d="M2 4h28" stroke="#6b8581"/>`),
  tile(14, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M0 8h25l7 17v7H0z" fill="${palette.roof}"/><path d="M0 13h28M0 19h30" stroke="${palette.roofLight}" stroke-width="2"/><path d="M0 27h32" stroke="${palette.shadow}" stroke-width="5"/><path d="M0 9h26" stroke="${palette.stoneLight}"/>`),
  tile(15, `<rect width="32" height="32" fill="${palette.stone}"/><path d="M5 32l4-25h14l4 25z" fill="${palette.rice}" stroke="${palette.teal}" stroke-width="3"/><path d="M10 14h13M8 24h17" stroke="#c9bfa7"/><rect x="13" y="19" width="7" height="13" fill="${palette.wood}"/><rect x="15" y="22" width="2" height="3" fill="${palette.gold}"/>`),
  tile(16, `<rect width="32" height="32" fill="${palette.grass}"/><path d="M9 32l2-32h10l2 32z" fill="${palette.rice}" stroke="${palette.teal}" stroke-width="3"/><path d="M11 7h10M10 20h13" stroke="#c9bfa7"/><rect x="14" y="10" width="5" height="7" fill="#f4c969"/><rect x="15" y="11" width="3" height="5" fill="#ffe7a1"/>`),
  tile(17, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="4" y="8" width="24" height="19" fill="${palette.gold}" opacity=".2"/><path d="M7 25h18l-3 7H10z" fill="${palette.teal}"/><rect x="9" y="13" width="14" height="12" fill="#ffe39a" stroke="${palette.teal}" stroke-width="3"/><path d="M5 13L16 3l11 10z" fill="${palette.cinnabar}"/><circle cx="16" cy="18" r="3" fill="${palette.gold}"/>`),
  tile(18, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="5" y="7" width="22" height="18" fill="${palette.cinnabar}"/><path d="M10 11h12v3H10zm0 6h12v3H10z" fill="${palette.gold}"/>`),
  tile(19, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="6" y="5" width="20" height="22" fill="${palette.teal}"/><path d="M10 9h12v3H10zm0 6h12v3H10zm0 6h8v3h-8z" fill="${palette.rice}"/>`),
  tile(20, `<rect width="32" height="32" fill="${palette.rice}"/><circle cx="16" cy="16" r="10" fill="none" stroke="${palette.wood}" stroke-width="4"/><circle cx="16" cy="16" r="3" fill="${palette.cinnabar}"/><path d="M16 3v26M3 16h26M7 7l18 18M25 7L7 25" stroke="${palette.wood}" stroke-width="2"/>`),
  tile(21, `<rect width="32" height="32" fill="${palette.rice}"/><path d="M2 13L16 3l14 10v19H2z" fill="${palette.rice}" stroke="${palette.teal}" stroke-width="3"/><rect x="12" y="19" width="8" height="13" fill="${palette.wood}"/>`),
  tile(22, `<rect width="32" height="32" fill="${palette.water}"/><path d="M3 20h26l-6 8H9z" fill="${palette.wood}"/><rect x="15" y="4" width="2" height="17" fill="#513a32"/><path d="M17 5l10 10H17z" fill="${palette.rice}"/>`),
  tile(23, `<rect width="32" height="32" fill="${palette.water}"/><path d="M0 25c8-11 24-11 32 0v7H0z" fill="${palette.waterDark}"/><path d="M0 23c9-11 23-11 32 0" fill="none" stroke="${palette.stone}" stroke-width="6"/><path d="M2 21c9-8 19-8 28 0" fill="none" stroke="${palette.stoneLight}" stroke-width="2"/>`),
  tile(24, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="5" y="6" width="22" height="20" fill="#537a58"/><path d="M10 20c0-7 12-7 12 0M16 10v13" fill="none" stroke="${palette.rice}" stroke-width="2"/><circle cx="16" cy="11" r="3" fill="${palette.gold}"/>`),
  tile(25, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="5" y="6" width="22" height="20" fill="${palette.cinnabar}"/><rect x="12" y="9" width="8" height="12" fill="#ffe39a"/><path d="M10 8h12M10 22h12" stroke="${palette.gold}" stroke-width="2"/>`),
  tile(26, `<rect width="32" height="32" fill="${palette.rice}"/><rect x="5" y="6" width="22" height="20" fill="${palette.waterDark}"/><path d="M8 16c5-6 11-6 16 0-5 6-11 6-16 0zm13 0 5-4v8z" fill="${palette.stoneLight}"/><circle cx="12" cy="15" r="1" fill="${palette.shadow}"/>`),
  tile(27, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="14" y="19" width="5" height="13" fill="${palette.wood}"/><circle cx="10" cy="12" r="7" fill="${palette.blossom}"/><circle cx="21" cy="11" r="8" fill="#d889a0"/><circle cx="16" cy="6" r="7" fill="#f0b7c4"/><path d="M7 9h4m8-2h5m-11 8h6" stroke="${palette.rice}" stroke-width="2"/>`),
  tile(28, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="5" y="17" width="22" height="5" fill="${palette.wood}"/><rect x="7" y="22" width="4" height="8" fill="#513a32"/><rect x="21" y="22" width="4" height="8" fill="#513a32"/><path d="M6 18h20" stroke="${palette.gold}"/>`),
  tile(29, `<rect width="32" height="32" fill="${palette.grass}"/><rect x="13" y="22" width="7" height="10" fill="${palette.stone}"/><path d="M9 21h15l-3 4H12z" fill="${palette.stoneLight}"/><rect x="12" y="8" width="10" height="13" fill="${palette.cinnabar}"/><rect x="15" y="11" width="4" height="7" fill="#ffe69a"/><path d="M10 8h14l-4-4h-6z" fill="${palette.roof}"/>`),
  tile(30, `<rect width="32" height="32" fill="${palette.water}"/><path d="M4 21h24l-5 7H9z" fill="${palette.wood}"/><path d="M8 19h18" stroke="${palette.gold}" stroke-width="2"/><rect x="14" y="6" width="3" height="15" fill="#513a32"/><path d="M17 7l9 8h-9z" fill="${palette.cinnabar}"/><path d="M2 8h8m12 20h8" stroke="${palette.waterLight}"/>`),
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
              : index === 5
                ? `<rect x="21" y="5" width="5" height="5" fill="${accent}"/><rect x="23" y="3" width="2" height="3" fill="${accent}"/>`
                : index === 6
                  ? `<rect x="10" y="9" width="5" height="3" fill="${accent}"/><rect x="18" y="9" width="5" height="3" fill="${accent}"/><rect x="15" y="10" width="3" height="1" fill="${accent}"/>`
                  : index === 7
                    ? `<path d="M5 8h22L22 3H10z" fill="${accent}"/><rect x="24" y="18" width="4" height="9" fill="${palette.wood}"/>`
                    : '';
  const eyes = face
    ? side === 0
      ? `<rect x="12" y="11" width="2" height="2" fill="#302927"/><rect x="19" y="11" width="2" height="2" fill="#302927"/>`
      : `<rect x="${side < 0 ? 11 : 20}" y="11" width="2" height="2" fill="#302927"/>`
    : '';
  return `<g transform="translate(${x} ${y})"><rect x="8" y="28" width="17" height="3" fill="#102f35" opacity=".35"/><rect x="10" y="25" width="5" height="5" fill="#263f46" transform="translate(0 ${step})"/><rect x="18" y="25" width="5" height="5" fill="#263f46" transform="translate(0 ${-step})"/><rect x="8" y="15" width="17" height="12" fill="${robe}"/><rect x="8" y="24" width="17" height="3" fill="#102f35" opacity=".28"/><rect x="6" y="17" width="3" height="8" fill="${robe}"/><rect x="24" y="17" width="3" height="8" fill="${robe}"/><rect x="9" y="20" width="15" height="3" fill="${accent}"/><rect x="10" y="7" width="13" height="10" fill="${skin}"/><rect x="9" y="5" width="15" height="6" fill="${hair}"/><rect x="11" y="16" width="3" height="6" fill="white" opacity=".18"/>${eyes}${accessory}</g>`;
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
