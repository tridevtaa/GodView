import { uploadJoinPhoto, uploadPhoto } from "./api.js";

const SIZE = 400; // square, px: sharp on tiles and profiles, even on phones
// WebP at this quality averages about 11 KB per photo (JPEG about 22 KB, the
// camera originals 1 to 10 MB). Browsers that can't make WebP get JPEG.
const WEBP_QUALITY = 0.72;
const JPEG_QUALITY = 0.75;

const encode = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Centre-crops and scales an image file to a small SIZE×SIZE photo.
async function toThumbnail(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const webp = await encode(canvas, "image/webp", WEBP_QUALITY);
  const blob = webp?.type === "image/webp" ? webp : await encode(canvas, "image/jpeg", JPEG_QUALITY);
  if (!blob) throw new Error("encode-failed");
  return blob;
}

// Saves a new photo for a person; returns the fields to merge into it.
export async function savePhoto(schoolId, kind, person, file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  return uploadPhoto(schoolId, kind, person, await toThumbnail(file));
}

// Makes a small copy of a photo hosted elsewhere (the old ERP's storage) and
// keeps it as the person's photo. Full-size camera photos (often 1 to 10 MB)
// are too heavy for phones; the copy is SIZE×SIZE, about 30 KB.
export async function copyHostedPhoto(schoolId, kind, person) {
  const res = await fetch(person.photo_url, { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`photo-${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not-an-image");
  return uploadPhoto(schoolId, kind, person, await toThumbnail(blob));
}

// A staff member's own photo for their join request.
export async function saveJoinPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  return uploadJoinPhoto(await toThumbnail(file));
}
