// Client-side packaging label OCR using Tesseract.js.
// Runs locally in the browser to detect Batch numbers, Dates and FSSAI License numbers from photos.
import {createWorker} from "tesseract.js";

export async function scanLabelPhoto(imageSource, onStatus) {
  try {
    onStatus?.("Initializing OCR engine…");
    const worker = await createWorker("eng");
    onStatus?.("Reading packaging label text…");
    const ret = await worker.recognize(imageSource);
    await worker.terminate();

    const text = ret.data.text || "";

    // Regex extraction tailored for Indian and international food labels
    const batchMatch = text.match(/(?:BATCH|LOT|B\.?\s*NO|LOT\.?\s*NO|B\/NO|L\/NO|BATCH\s*#)[:.\s#]+([A-Z0-9\/-]{3,24})/i);
    const mfdMatch = text.match(/(?:MFD|MFG|PACKED|PKD|M\/D)[:.\s#]+([0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4}|[A-Z]{3}[\s\/-][0-9]{2,4})/i);
    const expMatch = text.match(/(?:EXP|EXPIRY|USE BY|BEST BEFORE|BB)[:.\s#]+([0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4}|[A-Z]{3}[\s\/-][0-9]{2,4})/i);
    const fssaiMatch = text.match(/(?:FSSAI|LIC|LICENSE|LICENCE)[:.\s]*(?:NO\.?)?[:.\s#]*([0-9]{14})/i) || text.match(/\b(1[0-9]{13})\b/);

    return {
      success: true,
      rawText: text,
      batch: batchMatch ? batchMatch[1].trim() : null,
      mfd: mfdMatch ? mfdMatch[1].trim() : null,
      exp: expMatch ? expMatch[1].trim() : null,
      fssai: fssaiMatch ? fssaiMatch[1].trim() : null,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || "Failed to process image with OCR",
      rawText: "",
    };
  }
}
