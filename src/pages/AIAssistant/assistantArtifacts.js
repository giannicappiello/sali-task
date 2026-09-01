import { assistantReportFilename, assistantReportTitle, buildAssistantPdf } from "./assistantPdf.js";
import { buildAssistantChartSvg } from "./assistantChart.js";

async function composeWorkspacePdf(input) {
  const service = await import("../../services/companyDocuments.js");
  return service.composeWorkspacePdf(input);
}

export function buildAssistantArtifactFile(artifact, content) {
  if (artifact?.kind === "chart") {
    const blob = new Blob([buildAssistantChartSvg(content)], { type: "image/svg+xml;charset=utf-8" });
    return { blob, fileName: artifact.fileName || "grafico-analisi.svg", mediaType: "image/svg+xml" };
  }
  const doc = buildAssistantPdf({ content, author: "Progre AI", includeChart: artifact?.includeChart === true });
  const blob = doc.output("blob");
  const requestedName = artifact?.fileName;
  const fileName = !requestedName || requestedName === "report-assistente-ai.pdf" ? assistantReportFilename(assistantReportTitle(content)) : requestedName;
  return { blob, fileName, mediaType: "application/pdf" };
}

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Logo aziendale non disponibile."));
    reader.readAsDataURL(blob);
  });
}

async function brandedRasterImage(artifact, content) {
  const logoResponse = await fetch("/progre-logo-white.png");
  if (!logoResponse.ok) throw new Error("Logo aziendale non disponibile.");
  const logoDataUrl = await blobAsDataUrl(await logoResponse.blob());
  const svg = buildAssistantChartSvg(content, { logoHref: logoDataUrl });
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise((resolve, reject) => {
      const source = new Image();
      source.onload = () => resolve(source);
      source.onerror = () => reject(new Error("Impossibile preparare l’immagine richiesta."));
      source.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Esportazione immagine non supportata dal browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mediaType = artifact?.mediaType === "image/jpeg" ? "image/jpeg" : "image/png";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mediaType, mediaType === "image/jpeg" ? 0.94 : undefined));
    if (!blob) throw new Error("Impossibile creare il file immagine.");
    return {
      blob,
      fileName: artifact?.fileName || (mediaType === "image/jpeg" ? "grafico-analisi.jpg" : "grafico-analisi.png"),
      mediaType,
    };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function buildAssistantArtifactFileAsync(artifact, content) {
  if (artifact?.kind === "image" || /^image\/(?:png|jpeg)$/.test(artifact?.mediaType || "")) {
    return brandedRasterImage(artifact, content);
  }
  if (artifact?.kind === "pdf" || artifact?.mediaType === "application/pdf") {
    let logoDataUrl = null;
    try {
      const logoResponse = await fetch("/progre-logo-white.png");
      if (logoResponse.ok) logoDataUrl = await blobAsDataUrl(await logoResponse.blob());
    } catch {
      // Il PDF usa il marchio testuale di riserva quando il logo non è raggiungibile.
    }
    const doc = buildAssistantPdf({ content, author: "Progre AI", includeChart: artifact?.includeChart === true, logoDataUrl, managedLetterhead: true });
    const requestedName = artifact?.fileName;
    const fileName = !requestedName || requestedName === "report-assistente-ai.pdf" ? assistantReportFilename(assistantReportTitle(content)) : requestedName;
    try {
      const composed = await composeWorkspacePdf({
        pdf: doc.output("arraybuffer"), documentTypeCode: "REPORT_ASSISTENTE_AI",
        documentExternalId: `assistant-report:${artifact?.id || crypto.randomUUID()}`,
        brand: "PROGRE", businessArea: "assistente_ai", language: "it",
      });
      return { blob: composed.blob, fileName, mediaType: "application/pdf", headingSnapshot: composed.snapshot };
    } catch (error) {
      if (error?.code !== "LETTERHEAD_NOT_CONFIGURED") throw error;
      const legacy = buildAssistantPdf({ content, author: "Progre AI", includeChart: artifact?.includeChart === true, logoDataUrl });
      return { blob: legacy.output("blob"), fileName, mediaType: "application/pdf", headingSnapshot: null };
    }
  }
  return buildAssistantArtifactFile(artifact, content);
}
