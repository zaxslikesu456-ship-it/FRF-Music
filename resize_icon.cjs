const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Read existing icon
const srcIconPath = path.resolve('C:/FRF/src-tauri/icons/icon.png');
const targetIconPath = path.resolve('C:/FRF/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');

function createSolidPNG(width, height) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData.writeUInt8(8, 8); // 8-bit depth
    ihdrData.writeUInt8(6, 9); // RGBA color type
    ihdrData.writeUInt8(0, 10);
    ihdrData.writeUInt8(0, 11);
    ihdrData.writeUInt8(0, 12);

    function makeChunk(type, data) {
        const len = data.length;
        const buf = Buffer.alloc(12 + len);
        buf.writeUInt32BE(len, 0);
        buf.write(type, 4, 4, 'ascii');
        data.copy(buf, 8);
        const crc = crc32(buf.slice(4, 8 + len));
        buf.writeUInt32BE(crc >>> 0, 8 + len);
        return buf;
    }

    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        table[i] = c;
    }

    function crc32(buf) {
        let crc = -1;
        for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
        return (crc ^ (-1)) >>> 0;
    }

    const scanlineWidth = width * 4 + 1;
    const rawData = Buffer.alloc(height * scanlineWidth);

    const cx = width / 2;
    const cy = height / 2;
    const radius = width * 0.44;

    for (let y = 0; y < height; y++) {
        const offset = y * scanlineWidth;
        rawData[offset] = 0; // Filter byte 0 (None)
        for (let x = 0; x < width; x++) {
            const pxOffset = offset + 1 + x * 4;
            const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            
            // Vibrant modern music glow background
            if (dist < radius) {
                const grad = dist / radius;
                // Deep Purple / Indigo to Neon Cyan gradient
                rawData[pxOffset] = Math.floor(147 * (1 - grad) + 6 * grad);     // R
                rawData[pxOffset + 1] = Math.floor(51 * (1 - grad) + 182 * grad); // G
                rawData[pxOffset + 2] = Math.floor(234 * (1 - grad) + 212 * grad); // B
                rawData[pxOffset + 3] = 255;
            } else {
                rawData[pxOffset] = 10;     // R
                rawData[pxOffset + 1] = 10; // G
                rawData[pxOffset + 2] = 15; // B
                rawData[pxOffset + 3] = 255;
            }
        }
    }

    const compressed = zlib.deflateSync(rawData);
    const ihdrChunk = makeChunk('IHDR', ihdrData);
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const icon1024 = createSolidPNG(1024, 1024);
fs.writeFileSync(targetIconPath, icon1024);
console.log('Successfully generated valid 1024x1024 AppIcon-512@2x.png for iOS Xcode 16!');
