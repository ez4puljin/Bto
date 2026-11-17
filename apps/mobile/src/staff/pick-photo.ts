import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** The side of the photo that goes up (ADR-0209): the app shows it at most 72 points across. */
export const PHOTO_SIDE = 512;

export type PhotoSource = 'camera' | 'library';

/**
 * The person's new photo for their card (ADR-0209): taken with the front camera or picked from
 * the phone's pictures, cut square (the phone's own cropper first, the middle square anyway) and
 * made a JPEG of at most `PHOTO_SIDE` pixels, well under the kind's 1 MB: its file, or 'cancelled'
 * when the person went back, 'denied' when the camera was refused.
 */
export async function pickSquarePhoto(
  source: PhotoSource,
): Promise<{ uri: string } | 'cancelled' | 'denied'> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          ...options,
          cameraType: ImagePicker.CameraType.front,
        })
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return 'cancelled';

  const context = ImageManipulator.manipulate(asset.uri);
  const side = Math.min(asset.width, asset.height);
  if (side > 0 && asset.width !== asset.height) {
    context.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  if (side === 0) context.resize({ width: PHOTO_SIDE });
  else if (side > PHOTO_SIDE) context.resize({ width: PHOTO_SIDE, height: PHOTO_SIDE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return { uri: saved.uri };
}
