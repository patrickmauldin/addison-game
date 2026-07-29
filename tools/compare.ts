/**
 * Crops the R-101 decision region out of both lots and lays them side by side.
 * This is the readability test from manifest 4.8: can a player tell a weed
 * patch from an intentional native bed at 100% zoom? Both crops are the same
 * anchor (YARD_4) at the same scale, so the only difference is the generator.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { renderLot, type LotSpec, anchor } from '../src/compositor.js';
import { iso } from '../src/core/projection.js';
import { CANVAS_W } from '../src/core/projection.js';
import lot04 from '../src/data/lots/bonerville_04.json';
import lot07 from '../src/data/lots/bonerville_07.json';

const CRC=(()=>{const t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
const crc32=(b:Uint8Array)=>{let c=-1;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&0xff]^(c>>>8);return (c^-1)>>>0;};
function chunk(t:string,d:Uint8Array){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,'ascii'),Buffer.from(d)]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
function png(rgba:Uint8ClampedArray,w:number,h:number){const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
const raw=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(rgba.buffer,y*w*4,w*4).copy(raw,y*(w*4+1)+1);}
return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',new Uint8Array(0))]);}

const CW = 132, CH = 104, K = 4, GAP = 8;
const [au, av] = anchor('YARD_4');
const c = iso(au, av, 0);
const x0 = Math.round(c.x - CW / 2), y0 = Math.round(c.y - CH / 2) - 6;

const specs = [lot04, lot07] as unknown as LotSpec[];
const outW = (CW * 2 + GAP) * K, outH = CH * K;
const out = new Uint8ClampedArray(new ArrayBuffer(outW * outH * 4));
out.fill(255);

specs.forEach((spec, i) => {
  const { raster } = renderLot(spec);
  const ox = i * (CW + GAP) * K;
  for (let y = 0; y < CH * K; y++) {
    for (let x = 0; x < CW * K; x++) {
      const sx = x0 + ((x / K) | 0), sy = y0 + ((y / K) | 0);
      const s = (sy * CANVAS_W + sx) * 4, d = ((y) * outW + ox + x) * 4;
      out[d] = raster.color[s]; out[d+1] = raster.color[s+1];
      out[d+2] = raster.color[s+2]; out[d+3] = 255;
    }
  }
});
writeFileSync('out/r101-pair.png', png(out, outW, outH));
console.log(`out/r101-pair.png  ${outW}x${outH}  (${CW}x${CH} native crop, ${K}x nearest-neighbour)`);
console.log('left  = 4412 weed_patch  (R-101 VIOLATION)');
console.log('right = 4418 native_bed  (LEGAL, same anchor)');
