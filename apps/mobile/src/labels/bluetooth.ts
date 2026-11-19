import { PermissionsAndroid, Platform } from 'react-native';
import { binaryString, chunksOf } from './escpos';
import { type NativeDevice, type NativeModule, nativeBluetooth } from './native-module';

// The phone's own Bluetooth printer: an 80 mm thermal printer paired in Android's settings, a
// Bluetooth Classic (SPP) serial port speaking ESC/POS. The module is `react-native-bluetooth-classic`
// (docs/modules/mobile.md §1m); `native-module.ts` is the one file that imports it, and a build
// without it only loses this printer.

export interface PairedPrinter {
  address: string;
  name: string;
}

/** The i18n key under `mobile.labels.errors` a failure shows. */
export type BluetoothFailure =
  'bluetoothMissing' | 'bluetoothOff' | 'bluetoothPermission' | 'printerNotFound' | 'printerWrite';

export class BluetoothError extends Error {
  readonly failure: BluetoothFailure;

  constructor(failure: BluetoothFailure) {
    super(failure);
    this.name = 'BluetoothError';
    this.failure = failure;
  }
}

function loadModule(): NativeModule {
  if (Platform.OS !== 'android' || nativeBluetooth === null) {
    throw new BluetoothError('bluetoothMissing');
  }
  return nativeBluetooth;
}

/** Android 12+ asks «Nearby devices» for the paired list and the connection; older ones need nothing. */
async function allowBluetooth(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return;
  const result = await PermissionsAndroid.request('android.permission.BLUETOOTH_CONNECT');
  if (result !== PermissionsAndroid.RESULTS.GRANTED)
    throw new BluetoothError('bluetoothPermission');
}

async function readyModule(): Promise<NativeModule> {
  const module = loadModule();
  await allowBluetooth();
  const on = await module.isBluetoothEnabled().catch(() => false);
  if (!on) throw new BluetoothError('bluetoothOff');
  return module;
}

/** The printers paired with the phone, by name. */
export async function pairedPrinters(): Promise<PairedPrinter[]> {
  const module = await readyModule();
  const devices = await module.getBondedDevices();
  return devices
    .map((device) => ({ address: device.address, name: device.name?.trim() || device.address }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Pause between pieces: a cheap printer's buffer drains slower than Bluetooth fills it. */
const GAP_MS = 25;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends the bytes to the paired printer at `address`, piece by piece, and lets go of it. */
export async function sendToPrinter(address: string, bytes: Uint8Array): Promise<void> {
  const module = await readyModule();
  const paired = await module.getBondedDevices();
  if (!paired.some((device) => device.address === address)) {
    throw new BluetoothError('printerNotFound');
  }
  let device: NativeDevice;
  try {
    device = await module.connectToDevice(address);
  } catch {
    throw new BluetoothError('printerNotFound');
  }
  try {
    for (const piece of chunksOf(bytes)) {
      // «binary»: one byte per character, so nothing is taken for text.
      await device.write(binaryString(piece), 'binary');
      await sleep(GAP_MS);
    }
  } catch {
    throw new BluetoothError('printerWrite');
  } finally {
    await device.disconnect().catch(() => undefined);
  }
}
