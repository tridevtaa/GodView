import { uploadJoinPhoto, uploadPhoto } from "./api.js";

// The longest side, px. The whole photo is kept (tiles crop it on screen),
// so the pop-up on the profile shows all of it. WebP at this quality is
// roughly 15 to 30 KB (the camera originals 1 to 10 MB). Browsers that
// can't make WebP get JPEG.
const SIZE = 600;
const WEBP_QUALITY = 0.72;
const JPEG_QUALITY = 0.75;

const encode = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Scales an image file down so its longest side is at most SIZE, uncropped.
export async function toThumbnail(file) {
  // Some WebKit versions reject the imageOrientation option outright; retry
  // without it rather than losing the photo over EXIF rotation.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
// are too heavy for phones; the copy is at most SIZE px on its longest side.
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
