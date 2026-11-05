// Stands in for lib/scan/camera.ts: a design reference never opens a camera, and this keeps ZXing's
// WebAssembly out of the bundle. ScanBox then hides its camera button.
export const SCAN_FORMATS = [];
export function cameraAvailable() {
  return false;
}
export async function createCodeDetector() {
  throw new Error('No camera in the design system');
}
