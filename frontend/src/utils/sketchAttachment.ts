import type { ProjectAttachment, SketchAttachment } from "../types/project";

const SUPPORTED_SKETCH_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_EMBEDDED_SKETCH_SIZE = 900 * 1024;

export type SketchViewState = {
  zoom: number;
  panX: number;
  panY: number;
};

export const defaultSketchView: SketchViewState = { zoom: 1, panX: 0, panY: 0 };

export async function createSketchAttachment(file: File): Promise<{ attachment: SketchAttachment; message: string }> {
  if (!SUPPORTED_SKETCH_TYPES.has(file.type)) {
    throw new Error("只支持 PNG / JPG / JPEG 草图文件。");
  }

  const dataUrl = await readAsDataUrl(file);
  const dimensions = await readImageSize(dataUrl);
  const shouldEmbed = file.size <= MAX_EMBEDDED_SKETCH_SIZE;
  const attachment: SketchAttachment = {
    id: `sketch_${Date.now()}`,
    type: "sketch",
    fileName: file.name,
    mimeType: file.type as SketchAttachment["mimeType"],
    size: file.size,
    createdAt: new Date().toISOString(),
    width: dimensions.width,
    height: dimensions.height,
    dataUrl: shouldEmbed ? dataUrl : undefined,
    previewUrl: dataUrl,
    needsLocalFile: !shouldEmbed,
    markups: []
  };

  return {
    attachment,
    message: shouldEmbed
      ? `已加载草图：${file.name}，会随项目 JSON 保存。`
      : `已加载草图：${file.name}。文件较大，项目 JSON 只保存元数据，导入后需要重新选择本地草图文件。`
  };
}

export function normalizeSketchAttachments(attachments: ProjectAttachment[]) {
  return attachments
    .filter(isSketchAttachment)
    .map((attachment) => ({
      ...attachment,
      previewUrl: attachment.dataUrl,
      needsLocalFile: !attachment.dataUrl,
      markups: Array.isArray(attachment.markups) ? attachment.markups : []
    }));
}

export function sanitizeAttachmentsForExport(attachments: ProjectAttachment[]): ProjectAttachment[] {
  return attachments.map((attachment) => {
    if (!isSketchAttachment(attachment)) return attachment;
    const { previewUrl, ...serializable } = attachment;
    return serializable;
  });
}

export function isSketchAttachment(value: unknown): value is SketchAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === "sketch" && typeof record.fileName === "string" && typeof record.mimeType === "string";
}

export function sketchSizeText(attachment: SketchAttachment) {
  const size = attachment.size >= 1024 * 1024
    ? `${(attachment.size / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round(attachment.size / 1024))} KB`;
  const dimensions = attachment.width && attachment.height ? ` · ${attachment.width} x ${attachment.height}` : "";
  return `${size}${dimensions}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("草图文件读取失败。"));
    reader.readAsDataURL(file);
  });
}

function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("草图图片无法预览，请检查文件是否损坏。"));
    image.src = dataUrl;
  });
}
