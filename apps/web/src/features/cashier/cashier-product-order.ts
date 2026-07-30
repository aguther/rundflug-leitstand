export function moveCashierProduct(
  productIds: readonly string[],
  productId: string,
  targetIndex: number,
): string[] {
  const sourceIndex = productIds.indexOf(productId);
  if (sourceIndex < 0 || productIds.length === 0) return [...productIds];
  const boundedTargetIndex = Math.max(0, Math.min(targetIndex, productIds.length - 1));
  if (sourceIndex === boundedTargetIndex) return [...productIds];
  const next = [...productIds];
  next.splice(sourceIndex, 1);
  next.splice(boundedTargetIndex, 0, productId);
  return next;
}

export function cashierProductOrderChanged(
  expectedProductIds: readonly string[],
  orderedProductIds: readonly string[],
): boolean {
  return (
    expectedProductIds.length !== orderedProductIds.length ||
    expectedProductIds.some((productId, index) => orderedProductIds[index] !== productId)
  );
}
