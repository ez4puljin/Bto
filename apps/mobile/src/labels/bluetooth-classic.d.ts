// What the app uses of `react-native-bluetooth-classic`, declared here so the types never depend on
// how a given install resolves the package's own (an unresolved one would be an `error` type).
declare module 'react-native-bluetooth-classic' {
  interface BluetoothClassicDevice {
    address: string;
    name?: string | null;
    isConnected(): Promise<boolean>;
    write(data: string, encoding?: string): Promise<boolean>;
    disconnect(): Promise<boolean>;
  }
  interface BluetoothClassicModule {
    isBluetoothEnabled(): Promise<boolean>;
    getBondedDevices(): Promise<BluetoothClassicDevice[]>;
    connectToDevice(
      address: string,
      options?: Record<string, unknown>,
    ): Promise<BluetoothClassicDevice>;
  }
  const module: BluetoothClassicModule;
  export default module;
}
