"use client";

import { useRef } from "react";

export default function ImageDropzone({
  images,
  setImages,
}: {
  images: string[];
  setImages: (imgs: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).slice(0, 3); // v1-lite cap
    const dataUrls = await Promise.all(chosen.map(fileToDataUrl));
    setImages([...images, ...dataUrls].slice(0, 3));
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Images (optional)</div>
          <div className="text-xs text-neutral-300">Upload up to 3 reference images for taste calibration.</div>
        </div>
        <button
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs hover:bg-neutral-800"
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          Add images
        </button>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {images.map((src, idx) => (
            <div key={idx} className="relative overflow-hidden rounded-lg border border-neutral-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`upload-${idx}`} className="h-24 w-full object-cover" />
              <button
                type="button"
                className="absolute right-1 top-1 rounded-md bg-neutral-950/80 px-2 py-1 text-[10px] text-neutral-200 hover:bg-neutral-900"
                onClick={() => setImages(images.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
