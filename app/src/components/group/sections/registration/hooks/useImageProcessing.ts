import { useCallback } from "react";
import {
  makeId,
  toBase64Payload,
  readFileAsDataUrl,
  getImageDimensions,
} from "../../../../../utils/imageHelpers";

export { makeId, toBase64Payload, readFileAsDataUrl, getImageDimensions };

export function useImageProcessing() {
  const processImageFile = useCallback(async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await getImageDimensions(dataUrl);
    return { dataUrl, ...dimensions };
  }, []);

  return {
    makeId,
    toBase64Payload,
    readFileAsDataUrl,
    getImageDimensions,
    processImageFile,
  };
}
