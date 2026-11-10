const fs = require('fs');
const path = require('path');
const sharp = require('/Users/zach/Code/WhereWeWere/node_modules/sharp');

const clientPublic = '/Users/zach/Code/WhereWeWere/client/public';

// Primary SVG definition (Standard Squircle: for favicon.svg, icon-192.svg, apple-touch-icon, and favicon.ico)
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fb923c"/>
      <stop offset="45%" stop-color="#ea580c"/>
      <stop offset="100%" stop-color="#9a3412"/>
    </linearGradient>
    <linearGradient id="pinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#fff7ed"/>
    </linearGradient>
    <radialGradient id="beaconGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="50%" stop-color="#fef08a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </radialGradient>
    <filter id="pinShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#431407" flood-opacity="0.38"/>
    </filter>
  </defs>
  <!-- Background Squircle -->
  <rect width="512" height="512" rx="116" fill="url(#bgGrad)"/>
  <rect x="6" y="6" width="500" height="500" rx="110" fill="none" stroke="white" stroke-opacity="0.25" stroke-width="3"/>

  <!-- Pin Mark with Warm Beacon Core -->
  <g filter="url(#pinShadow)">
    <path d="M 256 92
             C 178 92, 116 154, 116 234
             C 116 306, 186 380, 244 420
             C 251 425, 261 425, 268 420
             C 326 380, 396 306, 396 234
             C 396 154, 334 92, 256 92 Z"
          fill="url(#pinGrad)"/>
    <!-- Outer aperture ring (deep warm orange) -->
    <circle cx="256" cy="230" r="68" fill="#ea580c"/>
    <!-- Glowing beacon sun (golden radial gradient) -->
    <circle cx="256" cy="230" r="38" fill="url(#beaconGlow)"/>
    <!-- Pinpoint center spark -->
    <circle cx="256" cy="230" r="14" fill="#ffffff"/>
  </g>
</svg>`;

// Full-bleed SVG for Maskable Icons (no rounded squircle corners, scaled within the 80% safe zone)
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGradMask" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fb923c"/>
      <stop offset="45%" stop-color="#ea580c"/>
      <stop offset="100%" stop-color="#9a3412"/>
    </linearGradient>
    <linearGradient id="pinGradMask" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#fff7ed"/>
    </linearGradient>
    <radialGradient id="beaconGlowMask" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="50%" stop-color="#fef08a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </radialGradient>
    <filter id="pinShadowMask" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#431407" flood-opacity="0.38"/>
    </filter>
  </defs>
  <!-- Full bleed background for adaptive icon masking -->
  <rect width="512" height="512" fill="url(#bgGradMask)"/>

  <!-- Centered pin scaled inside 80% safe circle -->
  <g transform="translate(256, 256) scale(0.88) translate(-256, -256)" filter="url(#pinShadowMask)">
    <path d="M 256 92
             C 178 92, 116 154, 116 234
             C 116 306, 186 380, 244 420
             C 251 425, 261 425, 268 420
             C 326 380, 396 306, 396 234
             C 396 154, 334 92, 256 92 Z"
          fill="url(#pinGradMask)"/>
    <circle cx="256" cy="230" r="68" fill="#ea580c"/>
    <circle cx="256" cy="230" r="38" fill="url(#beaconGlowMask)"/>
    <circle cx="256" cy="230" r="14" fill="#ffffff"/>
  </g>
</svg>`;

function createIco(images) {
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = count * dirEntrySize;
  let offset = headerSize + dirSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  return Buffer.concat([
    header,
    ...dirEntries,
    ...images.map(img => img.buffer)
  ]);
}

async function buildAll() {
  const svgBuf = Buffer.from(faviconSvg);
  const maskableBuf = Buffer.from(maskableSvg);

  // 1. Write SVG files
  fs.writeFileSync(path.join(clientPublic, 'favicon.svg'), faviconSvg);
  fs.writeFileSync(path.join(clientPublic, 'icon-192.svg'), faviconSvg);
  fs.writeFileSync(path.join(clientPublic, 'icon-512.svg'), faviconSvg);
  fs.writeFileSync(path.join(clientPublic, 'icon-maskable-512.svg'), maskableSvg);
  console.log('SVG files written.');

  // 2. Generate PNG files
  await sharp(svgBuf).resize(180, 180).png().toFile(path.join(clientPublic, 'apple-touch-icon.png'));
  await sharp(svgBuf).resize(192, 192).png().toFile(path.join(clientPublic, 'icon-192.png'));
  await sharp(svgBuf).resize(512, 512).png().toFile(path.join(clientPublic, 'icon-512.png'));
  await sharp(maskableBuf).resize(512, 512).png().toFile(path.join(clientPublic, 'icon-maskable-512.png'));
  console.log('PNG files generated.');

  // 3. Generate multi-resolution favicon.ico (16, 32, 48)
  const icoSizes = [16, 32, 48];
  const icoImages = [];
  for (const s of icoSizes) {
    const b = await sharp(svgBuf).resize(s, s).png().toBuffer();
    icoImages.push({ width: s, height: s, buffer: b });
  }
  const icoBuffer = createIco(icoImages);
  fs.writeFileSync(path.join(clientPublic, 'favicon.ico'), icoBuffer);
  console.log('favicon.ico generated (16x16, 32x32, 48x48).');

  console.log('All favicon and app icon assets created successfully in client/public!');
}

buildAll().catch(console.error);
