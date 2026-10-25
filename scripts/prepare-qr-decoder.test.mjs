import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareQrDecoder } from "./prepare-qr-decoder.mjs";

const scannerRequire = createRequire(import.meta.resolve("@yudiel/react-qr-scanner"));
const decoderRequire = createRequire(scannerRequire.resolve("barcode-detector"));
const { ZXING_WASM_SHA256 } = decoderRequire("zxing-wasm/reader");

test("the local QR asset matches the decoder version actually used by the scanner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qr-decoder-test-"));
  try {
    const path = prepareQrDecoder(directory);
    const bytes = readFileSync(path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ZXING_WASM_SHA256);
    await WebAssembly.compile(bytes);
    assert.ok(readFileSync(join(directory, "LICENSE.txt"), "utf8").length > 1000);
    // An old build's asset must not survive a dependency change or damaged file.
    writeFileSync(path, "stale decoder");
    prepareQrDecoder(directory);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), ZXING_WASM_SHA256);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
