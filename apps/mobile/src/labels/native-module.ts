import RNBluetoothClassic from 'react-native-bluetooth-classic';

// The one place the native Bluetooth Classic module is imported (react-native-bluetooth-classic).
// What the app uses of it is these two shapes, so the rest of `src/labels` never touches the package.

export interface NativeDevice {
  address: string;
  name?: string | null;
  isConnected(): Promise<boolean>;
  write(data: string, encoding?: string): Promise<boolean>;
  disconnect(): Promise<boolean>;
}

export interface NativeModule {
  isBluetoothEnabled(): Promise<boolean>;
  getBondedDevices(): Promise<NativeDevice[]>;
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<NativeDevice>;
}

export const nativeBluetooth: NativeModule | null = RNBluetoothClassic;
