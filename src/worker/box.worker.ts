// The box generator off the main thread; src/core/box-client.ts sends the requests.
import type { BoxRequest, BoxResponse } from "../core/box-client";
import { generateBox } from "../core/generator";

interface WorkerScope {
  onmessage: ((e: { data: BoxRequest }) => void) | null;
  postMessage(m: BoxResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, spec } = e.data;
  try {
    scope.postMessage({ id, box: generateBox(spec) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
