import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { analysisArchiveWriterLimits, StreamingZipWriter } from "./analysis-archive-writer";

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    bytes += next.value.byteLength;
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

describe("streaming analysis archive writer", () => {
  it("writes entries without buffering the complete archive API", async () => {
    const writer = new StreamingZipWriter();
    const archivePromise = collect(writer.readable);
    await writer.addTextEntry("manifest.json", '{"formatVersion":1}\n');
    await writer.addTextEntry(
      "planning/runs.ndjson",
      (async function* () {
        yield new TextEncoder().encode('{"id":"run-1"}\n');
        yield new TextEncoder().encode('{"id":"run-2"}\n');
      })(),
    );
    await writer.finalize();
    const files = unzipSync(await archivePromise);
    const manifest = files["manifest.json"] ?? new Uint8Array();
    const runs = files["planning/runs.ndjson"] ?? new Uint8Array();

    expect(strFromU8(manifest)).toBe('{"formatVersion":1}\n');
    expect(strFromU8(runs)).toContain('"run-2"');
    expect(analysisArchiveWriterLimits.multipartPartBytes).toBe(5 * 1024 * 1024);
  });
});
