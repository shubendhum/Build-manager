import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export const UploadZone = ({ file, previewUrl, onFileSelected, onClear, disabled }) => {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (f) => {
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) {
      toast.error("Unsupported file. Please upload a JPEG, PNG or WEBP photo.");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Image too large. Maximum size is 10 MB.");
      return;
    }
    onFileSelected(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFile(e.dataTransfer.files?.[0]);
  };

  if (previewUrl) {
    return (
      <div className="relative rounded-md overflow-hidden border border-slate-700" data-testid="upload-preview">
        <img src={previewUrl} alt="Selected construction site" className="w-full h-64 object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-slate-900/85 backdrop-blur-sm px-4 py-2 flex items-center justify-between">
          <span className="text-xs text-slate-300 truncate pr-2" data-testid="upload-filename">{file?.name}</span>
          <button
            type="button"
            data-testid="upload-clear-button"
            onClick={onClear}
            disabled={disabled}
            className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-300 hover:text-amber-400 transition-colors duration-200 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="upload-dropzone"
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`cursor-pointer rounded-md border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500
        ${dragging ? "border-amber-500 bg-slate-800/60" : "border-slate-600 bg-slate-800/30 hover:border-amber-500 hover:bg-slate-800/50"}`}
    >
      <div className="h-12 w-12 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
        <ImagePlus className="h-6 w-6 text-amber-400" aria-hidden="true" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-200">Drop a construction photo here</p>
        <p className="text-xs text-slate-400 mt-1">or click to browse — JPEG, PNG, WEBP up to 10 MB</p>
      </div>
      <input
        ref={inputRef}
        data-testid="upload-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
};
