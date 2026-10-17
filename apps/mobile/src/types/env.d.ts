/// <reference types="expo/types" />

/** A picture imported from assets/: Metro gives its asset id. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
