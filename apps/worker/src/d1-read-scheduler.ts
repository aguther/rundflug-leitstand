export interface D1BatchRead<TResult> {
  statement: D1PreparedStatement;
  project(result: D1Result<unknown>): TResult;
}

type D1BatchReadResults<TReads extends readonly D1BatchRead<unknown>[]> = {
  readonly [TIndex in keyof TReads]: TReads[TIndex] extends D1BatchRead<infer TResult>
    ? TResult
    : never;
};

export function d1All<T>(statement: D1PreparedStatement): D1BatchRead<D1Result<T>> {
  return {
    statement,
    project: (result) => result as D1Result<T>,
  };
}

export function d1First<T>(statement: D1PreparedStatement): D1BatchRead<T | null> {
  return {
    statement,
    project: (result) => (result.results[0] as T | undefined) ?? null,
  };
}

export function d1Read(statement: D1PreparedStatement) {
  return {
    all: <T>() => d1All<T>(statement),
    first: <T>() => d1First<T>(statement),
  };
}

export async function runD1ReadsInBatch<const TReads extends readonly D1BatchRead<unknown>[]>(
  database: D1Database,
  reads: TReads,
): Promise<D1BatchReadResults<TReads>> {
  const results = await database.batch(reads.map((read) => read.statement));
  if (results.length !== reads.length) {
    throw new Error(`D1 read batch returned ${results.length} results for ${reads.length} reads.`);
  }
  return reads.map((read, index) => {
    const result = results[index];
    if (!result) throw new Error(`D1 read batch result ${index} is missing.`);
    return read.project(result);
  }) as D1BatchReadResults<TReads>;
}

export async function runD1ReadsSequentially<const TResult extends readonly unknown[]>(
  tasks: { readonly [TIndex in keyof TResult]: () => Promise<TResult[TIndex]> },
): Promise<TResult> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as TResult;
}
