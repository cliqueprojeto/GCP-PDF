import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSignatureImage,cleanSignatureImage,signatureInkBounds,type PixelImage} from '../src/shared/signature-image';
function paper(color:number[]= [255,255,255],size=20):PixelImage{
 const data=new Uint8ClampedArray(size*size*4);for(let at=0;at<data.length;at+=4)data.set([...color,255],at);return {width:size,height:size,data};
}
test('existing full and partial alpha are preserved byte for byte, original pixels are never changed',()=>{
 const source=paper();source.data[3]=0;source.data[7]=128;const original=source.data.slice(),analysis=analyzeSignatureImage(source);
 assert.equal(analysis.transparent,true);assert.equal(analysis.background,null);
 assert.deepEqual(cleanSignatureImage(source,analysis,100,true).data,original);assert.deepEqual(source.data,original);
});
test('opaque coloured paper is estimated from the border; blue/black strokes survive, soft edges are unmatted',()=>{
 const source=paper([245,235,215]),at=(10*source.width+10)*4;source.data.set([15,25,110,255],at);source.data.set([220,210,190,255],at+4);
 const analysis=analyzeSignatureImage(source);assert.deepEqual(analysis.background,[245,235,215]);
 const result=cleanSignatureImage(source,analysis,35,true);assert.equal(result.data[3],0);assert.deepEqual([...result.data.slice(at,at+4)],[15,25,110,255]);assert.ok(result.data[at+7]!<255);
 assert.equal(source.data[3],255);assert.deepEqual(signatureInkBounds(result),{x:8,y:8,width:5,height:5});
 assert.deepEqual(cleanSignatureImage(source,analysis,100,false).data,source.data);
});
test('intensity is adjustable and a completely removed image has no ink bounds',()=>{
 const source=paper(),at=(10*source.width+10)*4;source.data.set([230,230,230,255],at);const analysis=analyzeSignatureImage(source);
 assert.ok(cleanSignatureImage(source,analysis,0,true).data[at+3]!>0);
 assert.equal(cleanSignatureImage(source,analysis,100,true).data[at+3],0);
 assert.equal(signatureInkBounds(cleanSignatureImage(paper(),analyzeSignatureImage(paper()),35,true)),null);
 assert.throws(()=>analyzeSignatureImage({width:100000,height:100000,data:new Uint8ClampedArray()}),/megapixels/);
});
