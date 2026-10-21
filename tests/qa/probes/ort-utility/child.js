// utilityProcess side of the QA3-01 probe (see main.js).
const path = require('path')
const root = path.join(__dirname, '..', '..', '..', '..', 'node_modules')
const mode = process.argv[process.argv.length - 1]
const model = process.env.MODEL
const ort = require(path.join(root, mode === 'web' ? 'onnxruntime-web' : 'onnxruntime-node'))
const opts = mode === 'web' ? { executionProviders: ['wasm'] } : {}
;(async () => {
  let s = await ort.InferenceSession.create(model, opts)
  for (let i = 0; i < 3; i++) {
    if (mode === 'node-fresh' && i > 0) s = await ort.InferenceSession.create(model, opts)
    const input = new ort.Tensor('float32', new Float32Array(3 * 1024 * 1024).fill(0.1 * i), [1, 3, 1024, 1024])
    const r = await s.run({ [s.inputNames[0]]: input }, [s.outputNames[0]])
    console.log(`run ${i}`, r[s.outputNames[0]].dims.join('x'))
  }
  process.exit(0)
})().catch((e) => {
  console.log('ERR', e)
  process.exit(1)
})
