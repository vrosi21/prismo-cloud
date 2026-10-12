import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

// Finds the subject of a picture with a small neural network that runs in this
// browser: the picture goes nowhere. The network is U²-Net ("p", the small
// one), public/models/u2netp.onnx. Both it and the runtime are served by this
// site, so nothing is fetched from anyone else.
//
// This file is only ever loaded with import(), so none of it weighs on the app
// until somebody asks for a cut-out.

// The network was trained on pictures squeezed into a square of this size,
// with colours shifted and scaled like this.
const SIDE = 320
const MEAN = [0.485, 0.456, 0.406]
const SPREAD = [0.229, 0.224, 0.225]

// The network answers "how likely is this the subject", 0..1. Anything it is
// fairly sure about either way is made definite, which keeps a faint haze of
// background from surviving around the subject.
const SURELY_NOT = 0.15
const SURELY = 0.85

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
// More than one thread needs a cross-origin isolated page, which this is not.
ort.env.wasm.numThreads = 1

let loading: Promise<ort.InferenceSession> | null = null

function network(): Promise<ort.InferenceSession> {
  loading ??= ort.InferenceSession.create('/models/u2netp.onnx', { executionProviders: ['wasm'] }).catch((e: unknown) => {
    loading = null // let the next try start over
    throw e
  })
  return loading
}

function blank(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/** For every pixel of the picture: how much of it is the subject, 0..255. */
export async function subjectMask(picture: HTMLCanvasElement): Promise<Uint8ClampedArray> {
  const session = await network()

  const small = blank(SIDE, SIDE)
  // Parts already erased are see-through, which a network reads as black.
  small.ctx.fillStyle = '#fff'
  small.ctx.fillRect(0, 0, SIDE, SIDE)
  small.ctx.drawImage(picture, 0, 0, SIDE, SIDE)
  const rgba = small.ctx.getImageData(0, 0, SIDE, SIDE).data

  // The network wants all reds, then all greens, then all blues.
  const area = SIDE * SIDE
  const input = new Float32Array(3 * area)
  for (let p = 0; p < area; p++) {
    for (let c = 0; c < 3; c++) input[c * area + p] = (rgba[p * 4 + c] / 255 - MEAN[c]) / SPREAD[c]
  }
  const answer = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) })
  const raw = answer[session.outputNames[0]].data as Float32Array

  let low = Infinity
  let high = -Infinity
  for (let p = 0; p < area; p++) {
    if (raw[p] < low) low = raw[p]
    if (raw[p] > high) high = raw[p]
  }
  const span = high - low || 1

  // Painted as a grey picture, the answer can be stretched back to the
  // picture's own size by the browser, smoothly.
  const grey = small.ctx.createImageData(SIDE, SIDE)
  for (let p = 0; p < area; p++) {
    const sure = ((raw[p] - low) / span - SURELY_NOT) / (SURELY - SURELY_NOT)
    grey.data.fill(sure * 255, p * 4, p * 4 + 3)
    grey.data[p * 4 + 3] = 255
  }
  small.ctx.putImageData(grey, 0, 0)

  const full = blank(picture.width, picture.height)
  full.ctx.drawImage(small.canvas, 0, 0, picture.width, picture.height)
  const stretched = full.ctx.getImageData(0, 0, picture.width, picture.height).data
  const mask = new Uint8ClampedArray(picture.width * picture.height)
  for (let p = 0; p < mask.length; p++) mask[p] = stretched[p * 4]
  return mask
}
