export async function runD1ReadsSequentially<const TResult extends readonly unknown[]>(
  tasks: { readonly [TIndex in keyof TResult]: () => Promise<TResult[TIndex]> },
): Promise<TResult> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as TResult;
}
