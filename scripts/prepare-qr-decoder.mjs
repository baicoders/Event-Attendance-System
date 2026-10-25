import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function writeIfChanged(path, bytes) {
  if (existsSync(path) && readFileSync(path).equals(bytes)) return;
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

/** Resolve through the scanner's own dependency tree to keep JS and WASM in sync. */
export function prepareQrDecoder(directory = fileURLToPath(new URL("../public/qr-decoder/", import.meta.url))) {
  const scannerRequire = createRequire(require.resolve("@yudiel/react-qr-scanner"));
  const decoderRequire = createRequire(scannerRequire.resolve("barcode-detector"));
  const wasm = decoderRequire.resolve("zxing-wasm/reader/zxing_reader.wasm");
  const packageDirectory = dirname(dirname(dirname(wasm)));
  mkdirSync(directory, { recursive: true });
  const target = join(directory, "zxing_reader.wasm");
  writeIfChanged(target, readFileSync(wasm));
  const notices = [
    "QR decoder: ZXing-C++ and ZXingWasm.cpp (Apache-2.0); zxing-wasm glue (MIT).",
    "Sources: https://github.com/zxing-cpp/zxing-cpp and https://github.com/Sec-ant/zxing-wasm",
    readFileSync(join(packageDirectory, "LICENSE"), "utf8"),
    readFileSync(new URL("./qr-decoder-licenses/Apache-2.0.txt", import.meta.url), "utf8"),
  ].join("\n\n");
  writeIfChanged(join(directory, "LICENSE.txt"), Buffer.from(notices));
  return target;
}
