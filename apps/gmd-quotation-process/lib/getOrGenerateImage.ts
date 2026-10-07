import { prisma } from "@/lib/prisma";
import { makeImageKey } from "./imageKey";
// LEGACY: Prompt-based image generation imports (discarded)
// import { generateValveImage } from "./openaiImageClient";
// import { saveImageFile } from "./imageStorage";

// const IMAGE_MODEL = "gpt-image-1.5";
// const PROMPT_VERSION = "v2";

/*
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
*/

export async function getOrGenerateImage(
  itemType: string,
  operationType: string,
  rmType: string,
): Promise<string | null> {
  const imageKey = makeImageKey(itemType, operationType, rmType);

  // Return existing image if present
  const existing = await prisma.generatedImage.findUnique({
    where: { imageKey },
    select: { url: true },
  });
  if (existing?.url) return existing.url;

  /* =========================================================================
   * LEGACY: Prompt-based image generation logic (discarded)
   * Preserved for reference.
   * =========================================================================
  const imageBuffer = await generateValveImage(itemType, operationType, rmType);
  const { url, driveFileId } = await saveImageFile(imageKey, imageBuffer);

  try {
    await prisma.generatedImage.create({
      data: {
        itemType,
        operationType,
        rmType,
        imageKey,
        url,
        driveFileId,
        promptVersion: PROMPT_VERSION,
        model: IMAGE_MODEL,
        status: "ready",
      },
    });
    return url;
  } catch (error) {
    // Race: a concurrent request inserted the same imageKey first.
    if (isUniqueConstraintError(error)) {
      const raced = await prisma.generatedImage.findUnique({
        where: { imageKey },
        select: { url: true },
      });
      if (raced?.url) return raced.url;
    }
    throw error;
  }
  ========================================================================= */

  return null;
}
