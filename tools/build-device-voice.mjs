// Build static, offline speech assets. Inference runs exclusively on the device.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'public/voice-assets');
const PREFIX = '/voice-assets/';
const WHISPER_REVISION = '51eefc0af78b103839eda9e7e4f4186acc6517fe';
const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const VOICES = ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hf = (repository, revision, path) => `https://huggingface.co/${repository}/resolve/${revision}/${path}`;
const files = [
  ['models/whisper/onnx/encoder_model_quantized.onnx', hf('onnx-community/whisper-base.en', WHISPER_REVISION, 'onnx/encoder_model_quantized.onnx'), 23201320, '6e8001198c490bbae018c0044f630c2915efb826bad957006ce36152d0ab2a10'],
  ['models/whisper/onnx/decoder_model_merged_quantized.onnx', hf('onnx-community/whisper-base.en', WHISPER_REVISION, 'onnx/decoder_model_merged_quantized.onnx'), 53692803, 'dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909'],
  ['models/kokoro/onnx/model_quantized.onnx', hf('onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'onnx/model_quantized.onnx'), 92361116, 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'],
  ['voices/af_heart.bin', hf('onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'voices/af_heart.bin'), 522240, 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'],
  ['voices/af_bella.bin', hf('onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'voices/af_bella.bin'), 522240, 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'],
  ['voices/af_nicole.bin', hf('onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'voices/af_nicole.bin'), 522240, 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a'],
  ['voices/am_michael.bin', hf('onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'voices/am_michael.bin'), 522240, '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'],
  ['voices/bf_emma.bin', hf('onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'voices/bf_emma.bin'), 522240, '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'],
];
const jsonFiles = [
  ['whisper', 'onnx-community/whisper-base.en', WHISPER_REVISION, 'config.json', 2197, '1d26eef96852a247a15abeee24630b81de8c5835'],
  ['whisper', 'onnx-community/whisper-base.en', WHISPER_REVISION, 'generation_config.json', 1556, '84c050f8e56d93c2b29d9768be849360960483a7'],
  ['whisper', 'onnx-community/whisper-base.en', WHISPER_REVISION, 'preprocessor_config.json', 339, '91876762a536a746d268353c5cba57286e76b058'],
  ['whisper', 'onnx-community/whisper-base.en', WHISPER_REVISION, 'tokenizer.json', 2405679, 'b5bd266de2f9b9a68efe13fb48ac6830ca71c0bb'],
  ['whisper', 'onnx-community/whisper-base.en', WHISPER_REVISION, 'tokenizer_config.json', 282662, '220314442bbc85c24bb2ee0b4b8d682615dd79e7'],
  ['kokoro', 'onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'config.json', 44, '790faf216e7e3f490e71e8bc80df79ed8941101c'],
  ['kokoro', 'onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'tokenizer.json', 3497, '4280f55fc1c32211bc9bb4d55545759a00054ecd'],
  ['kokoro', 'onnx-community/Kokoro-82M-v1.0-ONNX', KOKORO_REVISION, 'tokenizer_config.json', 113, '5c81e9a3a06db9139900d6ee5b60e8bb701ccb0b'],
].map(([alias, repository, revision, name, bytes, blob]) => [`models/${alias}/${name}`, hf(repository, revision, name), bytes, blob, 'git']);

async function digestFile(path, algorithm = 'sha256', bytes = null) {
  const digest = createHash(algorithm);
  if (algorithm === 'sha1') digest.update(`blob ${bytes}\0`);
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function getAsset([name, url, expectedBytes, expectedHash, kind]) {
  const target = join(OUTPUT, name), algorithm = kind === 'git' ? 'sha1' : 'sha256';
  await mkdir(dirname(target), { recursive: true });
  let current;
  try { current = await stat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current) {
    if (current.size !== expectedBytes || await digestFile(target, algorithm, expectedBytes) !== expectedHash) throw new Error(`Cached speech asset failed integrity: ${name}. Remove it and rebuild.`);
  } else {
    const temporary = `${target}.partial`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body) throw new Error(`Speech asset download failed: ${name} (${response.status}).`);
      let bytes = 0;
      const bound = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > expectedBytes ? new Error(`Speech asset exceeded pinned size: ${name}.`) : null, chunk);
      } });
      await streamPipeline(Readable.fromWeb(response.body), bound, createWriteStream(temporary));
      if (bytes !== expectedBytes || await digestFile(temporary, algorithm, expectedBytes) !== expectedHash) throw new Error(`Speech asset checksum failed: ${name}.`);
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
  return { url: PREFIX + name, bytes: expectedBytes, sha256: await digestFile(target) };
}

async function packageVersion(name, expected) {
  const metadata = JSON.parse(await readFile(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
  if (metadata.version !== expected) throw new Error(`Use pinned ${name}@${expected}; found ${metadata.version}.`);
}

async function bundleRuntime() {
  const kokoroFile = join(ROOT, 'node_modules/kokoro-js/dist/kokoro.js');
  const original = await readFile(kokoroFile, 'utf8');
  const voiceURL = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';
  if (original.split(voiceURL).length !== 2 || !original.includes('async function m(e,a="a",t=!0)')) throw new Error('Pinned Kokoro source no longer matches the local voice patch.');
  const voiceLoaderStart = original.indexOf('async function k(e){');
  const voiceLoaderEnd = original.indexOf('class M{', voiceLoaderStart);
  if (voiceLoaderStart < 0 || voiceLoaderEnd < 0) throw new Error('Pinned Kokoro voice loader no longer matches the local patch.');
  // Cache storage belongs to the verified app pack. Keep only Kokoro's RAM Map;
  // its original unversioned browser cache would duplicate/stale the five files.
  const loader = `async function k(e){if(!${JSON.stringify(VOICES)}.includes(e))throw new Error('Choose an installed voice.');if(G.has(e))return G.get(e);const r=await fetch('${PREFIX}voices/'+e+'.bin');if(!r.ok)throw new Error('Installed voice data is unavailable.');const a=new Float32Array(await r.arrayBuffer());G.set(e,a);return a;}`;
  const patched = original.slice(0, voiceLoaderStart) + loader + original.slice(voiceLoaderEnd) + '\nexport { m as phonemize };\n';
  const transformers = join(ROOT, 'node_modules/@huggingface/transformers/src/transformers.js');
  const ort = join(ROOT, 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs');
  const entry = `import {pipeline,env} from '@huggingface/transformers';
import {KokoroTTS,phonemize} from 'kokoro-js';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='${PREFIX}models/';
env.useBrowserCache=false;env.useFS=false;env.useFSCache=false;
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
env.backends.onnx.wasm.wasmPaths='${PREFIX}ort/';
export {pipeline,env,KokoroTTS,phonemize};`;
  const result = await build({ stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'device-voice-runtime.js' }, bundle: true, write: false, minify: true,
    format: 'esm', platform: 'browser', target: ['es2022'], legalComments: 'inline',
    plugins: [{ name: 'local-cpu-speech', setup(builder) {
      builder.onResolve({ filter: /^@huggingface\/transformers$/ }, () => ({ path: transformers }));
      builder.onResolve({ filter: /^kokoro-js$/ }, () => ({ path: kokoroFile, namespace: 'local-kokoro' }));
      builder.onLoad({ filter: /.*/, namespace: 'local-kokoro' }, () => ({ contents: patched, loader: 'js', resolveDir: dirname(kokoroFile) }));
      builder.onResolve({ filter: /^onnxruntime-web$/ }, () => ({ path: ort }));
      builder.onResolve({ filter: /^(?:node:)?(?:fs(?:\/promises)?|path|url)$|^onnxruntime-node$|^sharp$/ }, args => ({ path: args.path, namespace: 'browser-empty' }));
      builder.onLoad({ filter: /.*/, namespace: 'browser-empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }], metafile: true });
  if (result.outputFiles.length !== 1) throw new Error('Speech runtime must remain a single module.');
  const data = result.outputFiles[0].contents;
  const source = new TextDecoder().decode(data);
  if (source.includes(voiceURL) || source.includes('kokoro-voices')) throw new Error('Remote or duplicate Kokoro voice cache remained in the browser runtime.');
  await writeFile(join(OUTPUT, 'runtime.js'), data);
  return { url: PREFIX + 'runtime.js', bytes: data.length, sha256: sha256(data) };
}

async function copyAsset(name, source) {
  const data = await readFile(join(ROOT, source)), target = join(OUTPUT, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  return { url: PREFIX + name, bytes: data.length, sha256: sha256(data) };
}

async function licenseAsset() {
  const apache = await readFile(join(ROOT, 'node_modules/@huggingface/transformers/LICENSE'), 'utf8');
  const gpl = await readFile(join(ROOT, 'tools/licenses/espeak-ng-GPL-3.0.txt'), 'utf8');
  const mit = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
  const data = Buffer.from(`StudyChat device speech assets\n\nApache-2.0: Transformers.js 3.8.1 (Hugging Face), kokoro-js 1.2.1 (hexgrad), phonemizer 1.2.1 JavaScript wrapper (Xenova), Kokoro model weights.\nSources: https://github.com/huggingface/transformers.js ; https://github.com/hexgrad/kokoro ; https://github.com/xenova/phonemizer.js ; https://huggingface.co/hexgrad/Kokoro-82M\n\n${apache}\n\nMIT: ONNX Runtime Web\nCopyright (c) Microsoft Corporation\nSource: https://github.com/microsoft/onnxruntime\n\n${mit}\n\nMIT: Whisper model weights\nCopyright (c) 2022 OpenAI\nSource: https://github.com/openai/whisper\n\n${mit}\n\nGPL-3.0-or-later: eSpeak NG engine and language data embedded in phonemizer 1.2.1.\nBased on eSpeak by Jonathan Duddington; eSpeak NG is maintained by Reece H. Dunn and contributors.\nThis build bundles the published engine/data with the JavaScript wrapper and minifies the resulting module. No changes were made to the eSpeak C implementation.\nThe published phonemizer package does not identify the eSpeak NG C source commit used for its compiled engine; that provenance is not inferred here.\nEngine source: https://github.com/espeak-ng/espeak-ng\nExact distributed phonemizer source: https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278\nEmbedded engine source: https://github.com/xenova/phonemizer.js/blob/6835144b7ee9043129222549c1ed2f6a27216278/src/espeakng.worker.js\nData source: https://github.com/xenova/phonemizer.js/blob/6835144b7ee9043129222549c1ed2f6a27216278/data/espeakng.worker.data\n\n${gpl}\n`);
  await writeFile(join(OUTPUT, 'LICENSES.txt'), data);
  return { url: PREFIX + 'LICENSES.txt', bytes: data.length, sha256: sha256(data) };
}

await packageVersion('kokoro-js', '1.2.1');
await packageVersion('@huggingface/transformers', '3.8.1');
await packageVersion('phonemizer', '1.2.1');
await packageVersion('onnxruntime-web', '1.22.0-dev.20250409-89f8206ba4');
await mkdir(OUTPUT, { recursive: true });
const assets = [await bundleRuntime(), await licenseAsset()];
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) assets.push(await copyAsset(`ort/${name}`, `node_modules/onnxruntime-web/dist/${name}`));
// Downloads are sequential and streamed; the build never buffers full models.
for (const asset of [...files, ...jsonFiles]) {
  assets.push(await getAsset(asset));
  console.log(`Verified ${asset[0]} (${asset[2]} bytes)`);
}
assets.sort((a, b) => a.url.localeCompare(b.url));
const version = 'studychat-device-voice-v1-' + sha256(JSON.stringify(assets)).slice(0, 20);
const manifest = { version, cacheName: version, runtime: PREFIX + 'runtime.js', sampleRate: 24000, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  voices: VOICES, models: { whisper: { id: 'whisper', source: 'onnx-community/whisper-base.en', revision: WHISPER_REVISION, dtype: 'q8' }, kokoro: { id: 'kokoro', source: 'onnx-community/Kokoro-82M-v1.0-ONNX', revision: KOKORO_REVISION, dtype: 'q8' } }, assets };
await writeFile(join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${assets.length} local voice assets: ${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MiB. Version ${version}.`);
