// QA3-01 minimal repro: onnxruntime in an Electron utilityProcess, session.run() three times.
//   MODEL=<isnet-general-use.onnx> xvfb-run -a node_modules/electron/dist/electron --no-sandbox \
//     tests/qa/probes/ort-utility/main.js <node|node-fresh|web>
// Observed (Electron 45, onnxruntime-node 1.30, Linux): "node" → run 0 ok, then child exit 5;
// "node-fresh" (new session per run) → 3/3 ok; "web" (wasm) → 3/3 ok.
const { app, utilityProcess } = require('electron')
const path = require('path')
app.whenReady().then(() => {
  const mode = process.argv[process.argv.length - 1]
  const c = utilityProcess.fork(path.join(__dirname, 'child.js'), [mode], { stdio: 'inherit', env: process.env })
  c.on('exit', (code) => {
    console.log(`mode ${mode}: child exit ${code}`)
    app.quit()
  })
})
