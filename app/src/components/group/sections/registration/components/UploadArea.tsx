import { useCallback } from "react";
import { useImageProcessing } from "@/components/group/sections/registration/hooks/useImageProcessing";

interface UploadAreaProps {
  onFileProcessed: (dataUrl: string, width: number, height: number) => void;
  onError: (msg: string) => void;
}

export function UploadArea({ onFileProcessed, onError }: UploadAreaProps) {
  const { processImageFile } = useImageProcessing();

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];

      if (!file.type.startsWith("image/")) {
        onError("Please upload a valid image file.");
        return;
      }

      try {
        const { dataUrl, width, height } = await processImageFile(file);
        onFileProcessed(dataUrl, width, height);
      } catch {
        onError("Failed to process the selected image.");
      }
      e.target.value = "";
    },
    [processImageFile, onFileProcessed, onError],
  );

  return (
    <div className="h-full w-full relative">
      <label className="h-full flex cursor-pointer flex-col items-center justify-center p-8 text-center hover:bg-white/5 transition-all group">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
            <i className="fa-solid fa-cloud-arrow-up text-3xl text-white/20 group-hover:text-cyan-400 transition-colors"></i>
          </div>
          <div>
            <div className="text-sm font-semibold text-white/80 mb-1">
              Drop image or click to browse
            </div>
            <div className="text-[10px] uppercase font-black tracking-widest text-white/20">
              PNG, JPG up to 10MB
            </div>
          </div>
        </div>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
}
