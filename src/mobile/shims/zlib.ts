import {gunzipSync as gunzip, inflateSync as inflate, deflateSync as deflate, gzipSync as gzip, unzlibSync, zlibSync} from 'fflate';
import {Buffer} from 'buffer';
const wrap = (fn: (data: Uint8Array) => Uint8Array) => (data: Uint8Array) => Buffer.from(fn(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
export const gunzipSync = wrap(gunzip), gzipSync = wrap(d => gzip(d)), inflateSync = wrap(unzlibSync), deflateSync = wrap(d => zlibSync(d)), inflateRawSync = wrap(inflate), deflateRawSync = wrap(d => deflate(d));
export default {gunzipSync, gzipSync, inflateSync, deflateSync, inflateRawSync, deflateRawSync};
