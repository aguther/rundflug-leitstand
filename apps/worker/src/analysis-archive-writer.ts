import { Zip, ZipDeflate } from "fflate";

const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

type TextSource = string | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

function asAsyncIterable(source: TextSource): AsyncIterable<Uint8Array> {
  if (typeof source === "string") {
    const bytes = new TextEncoder().encode(source);
    return (async function* () {
      if (bytes.byteLength > 0) yield bytes;
    })();
  }
  if (source instanceof ReadableStream)
    return (async function* () {
      const reader = source.getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        reader.releaseLock();
      }
    })();
  return source;
}

export class StreamingZipWriter {
  readonly readable: ReadableStream<Uint8Array>;

  private readonly output: WritableStreamDefaultWriter<Uint8Array>;
  private readonly zip: Zip;
  private outputTail: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private finalized = false;

  constructor() {
    const transport = new TransformStream<Uint8Array, Uint8Array>();
    this.readable = transport.readable;
    this.output = transport.writable.getWriter();
    this.zip = new Zip((error, data, final) => {
      if (error) {
        this.failure = error;
        this.outputTail = this.outputTail.then(() => this.output.abort(error));
        return;
      }
      if (data.byteLength > 0) {
        const stableCopy = data.slice();
        this.outputTail = this.outputTail.then(() => this.output.write(stableCopy));
      }
      if (final) this.outputTail = this.outputTail.then(() => this.output.close());
    });
  }

  async addTextEntry(path: string, source: TextSource): Promise<void> {
    if (this.finalized) throw new Error("ANALYSIS_ARCHIVE_ALREADY_FINALIZED");
    if (!path || path.startsWith("/") || path.includes("..")) {
      throw new Error("ANALYSIS_ARCHIVE_ENTRY_PATH_INVALID");
    }
    const entry = new ZipDeflate(path, { level: 6 });
    this.zip.add(entry);
    for await (const chunk of asAsyncIterable(source)) {
      if (this.failure) throw this.failure;
      entry.push(chunk, false);
      await this.outputTail;
    }
    entry.push(new Uint8Array(), true);
    await this.outputTail;
    if (this.failure) throw this.failure;
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.zip.end();
    await this.outputTail;
    if (this.failure) throw this.failure;
  }

  async abort(reason: unknown): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.zip.terminate();
    await this.output.abort(reason).catch(() => undefined);
  }
}

function concatenateChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function uploadMultipartStream(input: {
  bucket: R2Bucket;
  key: string;
  stream: ReadableStream<Uint8Array>;
  customMetadata: Record<string, string>;
}): Promise<R2Object> {
  const upload = await input.bucket.createMultipartUpload(input.key, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: input.customMetadata,
  });
  const uploadedParts: R2UploadedPart[] = [];
  const reader = input.stream.getReader();
  let buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  let partNumber = 1;

  const uploadPart = async (bytes: Uint8Array): Promise<void> => {
    uploadedParts.push(await upload.uploadPart(partNumber, bytes));
    partNumber += 1;
  };

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      let chunk = next.value;
      while (bufferedBytes + chunk.byteLength >= MULTIPART_PART_BYTES) {
        const needed = MULTIPART_PART_BYTES - bufferedBytes;
        buffered.push(chunk.subarray(0, needed));
        await uploadPart(concatenateChunks(buffered, MULTIPART_PART_BYTES));
        chunk = chunk.subarray(needed);
        buffered = [];
        bufferedBytes = 0;
      }
      if (chunk.byteLength > 0) {
        buffered.push(chunk);
        bufferedBytes += chunk.byteLength;
      }
    }
    if (bufferedBytes > 0 || uploadedParts.length === 0) {
      await uploadPart(concatenateChunks(buffered, bufferedBytes));
    }
    return await upload.complete(uploadedParts);
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export const analysisArchiveWriterLimits = {
  multipartPartBytes: MULTIPART_PART_BYTES,
} as const;
