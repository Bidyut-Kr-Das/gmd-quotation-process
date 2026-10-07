import { prisma } from "@/lib/prisma";

export async function getAiFeedbackContext(): Promise<string> {
  const feedback = await prisma.aiFeedback.findMany({
    orderBy: { createdAt: "desc" },
  });

  if (feedback.length === 0) return "";

  const sections = feedback.map((f) => {
    const briefPreview =
      f.briefText.length > 120
        ? f.briefText.slice(0, 120) + "..."
        : f.briefText;
    return [
      `Tender Brief: "${briefPreview}"`,
      `AI said: ${f.originalAi}, Correct: ${f.correctedAi}`,
      `Why wrong: ${f.feedbackReason}`,
    ].join("\n");
  });

  return (
    "\n\nPREVIOUS AI MISTAKES:\n" +
    sections.join("\n\n") +
    "\n\nLearn from these mistakes. Avoid repeating them."
  );
}
