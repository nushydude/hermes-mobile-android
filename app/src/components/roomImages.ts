export type RoomImage = { uri: string; path: string; mime: string };
export type RoomImages = { owner: object; images: RoomImage[] };
export function addRoomImages(
  current: RoomImages | null,
  owner: object,
  images: RoomImage[],
  owns: boolean,
): RoomImages | null {
  if (!owns || current?.owner !== owner) return current;
  return { owner, images: [...current.images, ...images] };
}
export function visibleRoomImages(
  current: RoomImages | null,
  owner: object,
  draft: RoomImage[],
): RoomImage[] {
  return current?.owner === owner
    ? current.images.filter((image) => draft.some((value) => value.path === image.path))
    : [];
}
