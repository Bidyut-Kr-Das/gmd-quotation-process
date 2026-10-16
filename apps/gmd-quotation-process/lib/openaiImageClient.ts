/**
 * =============================================================================
 * LEGACY CODE: Prompt-based Valve Image Generation
 * =============================================================================
 * The prompt-based image generation logic has been discarded in favor of
 * direct product image assets.
 *
 * The code below is preserved as legacy reference.
 * =============================================================================
 */

/*
import { generateImage } from "ai";
import { openai } from "@ai-sdk/openai";
import { OPENAI_API_KEY } from "@/lib/config";
import { rmTypeForPrompt } from "./imageKey";

const IMAGE_MODEL = "gpt-image-1.5";

const SYSTEM_PROMPT = `You are a professional industrial product photographer and 3D catalog visualizer creating authentic, high-resolution commercial product catalog photos of industrial valves.

Product styling and physical appearance:
- Genuine, tangible industrial product shot (photorealistic commercial manufacturing catalog photograph).
- Valve Body: Heavy-duty cast iron / ductile iron industrial body finished in a vibrant industrial safety blue epoxy or powder-coated finish with authentic cast-metal texture, clean circular flange rims, and precision-drilled bolt holes.
- Brand Name "DALUI": The brand name "DALUI" must be clearly, legibly, and prominently featured:
  * Cast in raised embossed capital letters ("DALUI") directly onto the blue valve neck/body casting.
  * Cleanly engraved or laser-etched in capital letters ("DALUI") onto the front face of the metal valve disc/gate/ball.
- Internal Components: Precision-machined metallic disc and shaft/stem (machined stainless steel finish) seated firmly inside a smooth black resilient elastomeric rubber (EPDM/PTFE) seat liner.
- Actuation / Operation: Accurately rendered actuation mechanism matching the requested operation (e.g., heavy-duty matte black manual lever handle with squeeze-release notch positioning latch and stainless steel mounting hardware, or heavy-duty gear operator with handwheel, or pneumatic/electric actuator).

Studio Environment & Lighting:
- Seamless, pure solid white background (#FFFFFF) with a subtle, natural soft contact shadow underneath the base of the valve for realistic grounding.
- Commercial studio product lighting with crisp highlights and natural soft reflections showcasing 3D depth, material finishes, and fine contours.
- Centered framing, 3/4 isometric perspective angle showing the flange face, bolt holes, inner disc mechanism, and top operator.
- Square 1:1 aspect ratio, 1024x1024 resolution.

Strict Negative Directives:
- Absolutely DO NOT generate sketches, line art, wireframes, blueprints, CAD drawings, pencil/ink drawings, watercolor, or flat 2D vector illustrations.
- Must look like a real, tangible physical product photographed in a professional studio.
- No people, no factory clutter, no artificial floating watermarks or extra text except the requested "DALUI" brand marking.`;

export async function generateValveImage(
  itemType: string,
  operationType: string,
  rmType: string,
): Promise<Buffer> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      `Image generation failed for ${itemType}/${operationType}/${rmType}: OPENAI_API_KEY is not configured.`,
    );
  }

  const formattedRmType = rmTypeForPrompt(rmType);
  const userPrompt = `Product specifications:
- Valve Type: ${itemType}
- Actuation / Operation: ${operationType}
- Material Construction / Rating: ${formattedRmType}
- Brand Name: "DALUI" prominently embossed on the blue body casting and engraved on the disc face.
Produce a realistic, high-detail studio product photograph matching these exact specifications.`;

  try {
    const { image } = await generateImage({
      model: openai.image(IMAGE_MODEL),
      prompt: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
      size: "1024x1024",
      providerOptions: {
        openai: { quality: "medium", outputFormat: "png" },
      },
    });

    if (!image?.base64) {
      throw new Error("the model returned no image data");
    }

    return Buffer.from(image.base64, "base64");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Image generation failed for ${itemType}/${operationType}/${rmType}: ${message}`,
    );
  }
}
*/

// Legacy export stub to prevent breaking external imports if referenced
export async function generateValveImage(
  _itemType: string,
  _operationType: string,
  _rmType: string,
): Promise<Buffer> {
  throw new Error(
    "Legacy function: Prompt-based image generation has been discarded.",
  );
}
