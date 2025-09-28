// app/api/generate-model/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FAL_KEY = process.env.FAL_KEY || "";
fal.config({ credentials: FAL_KEY });

type Body = {
  ethnicity: string;
  gender: string;
  style?: "studio" | "street" | "runway" | "catalog";
};

const STYLE_PROMPTS = {
  studio:  "clean studio lighting, seamless background",
  street:  "street fashion vibe, natural daylight, shallow depth of field",
  runway:  "runway atmosphere, spotlight, glossy floor",
  catalog: "plain light background, even lighting, catalog look",
} as const;

export async function POST(req: NextRequest) {
  try {
    if (!FAL_KEY) {
      return NextResponse.json({ error: "FAL_KEY is not configured on server" }, { status: 500 });
    }

    const { ethnicity, gender, style = "studio" } = (await req.json()) as Body;
    if (!ethnicity || !gender) {
      return NextResponse.json({ error: "Missing ethnicity or gender" }, { status: 400 });
    }

    const styleKey = (["studio","street","runway","catalog"] as const).includes(style as any)
      ? (style as keyof typeof STYLE_PROMPTS)
      : "studio";

    const prompt =
      `full-body fashion model, ${gender.toLowerCase()}, ` +
      `${ethnicity.toLowerCase()} appearance, ${STYLE_PROMPTS[styleKey]}. ` +
      `neutral pose, arms relaxed, photorealistic, high quality`;

    const out = await fal.subscribe("fal-ai/nano-banana", {
      input: {
        prompt,
        num_images: 1,
        output_format: "png",
        // seed: 123456789, // optional: determinism
        sync_mode: false,
      },
      logs: false,
    });

    const data: any = (out as any)?.data ?? {};
    const img =
      data?.images?.[0] ??
      data?.image ??
      (Array.isArray(data?.output) ? data.output[0] : undefined);

    const image_url: string | undefined = img?.url ?? img?.data;
    if (!image_url) {
      return NextResponse.json({ error: "Model generation failed: no image in response" }, { status: 500 });
    }

    return NextResponse.json({ image_url });
  } catch (err: any) {
    console.error("[/api/generate-model] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
