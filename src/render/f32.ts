// Float32 stores that report change, so per-frame writers upload only what moved. Pure.

/** Store `v` at `arr[i]` and say whether the stored float32 changed. Allocation-free. */
export function storeF32(arr: Float32Array, i: number, v: number): boolean {
  const f = Math.fround(v);
  if (arr[i] === f) return false;
  arr[i] = f;
  return true;
}
