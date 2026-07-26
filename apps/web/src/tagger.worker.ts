/// <reference lib="webworker" />
/**
 * Ephemeral ONNX worker: create session → run once → exit.
 * Main thread must worker.terminate() after the result so Safari can
 * reclaim WebAssembly.Memory (session.release() alone never shrinks it).
 */
import * as ort from "onnxruntime-web/wasm";

export type TaggerWorkerRequest = {
  type: "infer";
  modelId: string;
  opfsDir: string;
  inputName: string;
  dims: number[];
  /** Transferred Float32Array buffer */
  input: Float32Array;
  large: boolean;
};

export type TaggerWorkerProgress = {
  type: "progress";
  message: string;
};

export type TaggerWorkerResult =
  | { type: "ok"; probs: Float32Array }
  | { type: "error"; message: string };

declare const self: DedicatedWorkerGlobalScope;

function configure() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
}

async function openOpfsModel(opfsDir: string, modelId: string): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(opfsDir);
  return (await dir.getFileHandle(`${modelId}.onnx`)).getFile();
}

self.onmessage = async (ev: MessageEvent<TaggerWorkerRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "infer") return;

  try {
    configure();
    self.postMessage({
      type: "progress",
      message: "Worker で ONNX 初期化中…",
    } satisfies TaggerWorkerProgress);

    const file = await openOpfsModel(msg.opfsDir, msg.modelId);
    const objectUrl = URL.createObjectURL(file);
    let session: ort.InferenceSession | null = null;
    try {
      session = await ort.InferenceSession.create(objectUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: msg.large ? "disabled" : "basic",
        enableCpuMemArena: false,
        enableMemPattern: false,
        executionMode: "sequential",
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    self.postMessage({
      type: "progress",
      message: "Worker で推論中…",
    } satisfies TaggerWorkerProgress);

    const tensor = new ort.Tensor("float32", msg.input, msg.dims);
    const resolvedInput =
      !msg.inputName || msg.inputName === "auto"
        ? session.inputNames[0]
        : session.inputNames.includes(msg.inputName)
          ? msg.inputName
          : session.inputNames[0];
    const fetches = session.outputNames.includes("prediction")
      ? ["prediction"]
      : [session.outputNames[0]];
    const output = await session.run({ [resolvedInput]: tensor }, fetches);
    const out =
      output.prediction ?? output[session.outputNames[0]];
    const probs = Float32Array.from(out.data as Float32Array);
    tensor.dispose();
    out.dispose();
    await session.release();
    session = null;

    const result: TaggerWorkerResult = { type: "ok", probs };
    self.postMessage(result, [probs.buffer]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TaggerWorkerResult = { type: "error", message };
    self.postMessage(result);
  }
};
