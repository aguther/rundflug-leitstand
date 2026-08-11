import { sha256Hex } from "./crypto";

const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PUBLIC_CODE_LENGTH = 16;
const MAX_ALLOCATION_ATTEMPTS = 8;

type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
type CodeFactory = () => string;

export interface PublicSaleCodes {
  groupCode: string;
  groupCodeHash: string;
  ticketCodes: string[];
  ticketCodeHashes: string[];
}

export class PublicCodeAllocationError extends Error {
  constructor() {
    super("Unique public status codes could not be allocated.");
    this.name = "PublicCodeAllocationError";
  }
}

export function createPublicStatusCode(
  fillRandom: RandomFill = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fillRandom(new Uint8Array(PUBLIC_CODE_LENGTH));
  return Array.from(
    bytes,
    (value) => PUBLIC_CODE_ALPHABET[value % PUBLIC_CODE_ALPHABET.length],
  ).join("");
}

export async function allocatePublicSaleCodes(
  database: D1Database,
  ticketCount: number,
  createCode: CodeFactory = createPublicStatusCode,
): Promise<PublicSaleCodes> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const codes = Array.from({ length: ticketCount + 1 }, createCode);
    const groupCode = codes[0];
    const ticketCodes = codes.slice(1);
    if (!groupCode || ticketCodes.length !== ticketCount || new Set(codes).size !== codes.length) {
      continue;
    }

    const [groupCodeHash, ...ticketCodeHashes] = await Promise.all(codes.map(sha256Hex));
    if (!groupCodeHash || ticketCodeHashes.length !== ticketCount) continue;
    const hashes = [groupCodeHash, ...ticketCodeHashes];
    const placeholders = hashes.map(() => "?").join(", ");
    const collision = await database
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM ticket_groups WHERE public_status_code_hash IN (${placeholders})
           UNION ALL
           SELECT 1 FROM tickets WHERE public_code_hash IN (${placeholders})
         ) AS public_code_exists`,
      )
      .bind(...hashes, ...hashes)
      .first<{ public_code_exists: number }>();
    if (collision?.public_code_exists) continue;

    return { groupCode, groupCodeHash, ticketCodes, ticketCodeHashes };
  }

  throw new PublicCodeAllocationError();
}
