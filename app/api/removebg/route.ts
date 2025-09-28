// app/api/removebg/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

// ——— Next.js runtime ayarları ———
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ——— Model yapılandırması ———
const MODEL_ID = "fal-ai/transparent-background"; // ihtiyacına göre güncelle
const FAL_KEY = process.env.FAL_KEY || "";

fal.config({ credentials: FAL_KEY });

type RemoveBgBody = {
  image: string; // URL veya data:URI (base64)
  outputFormat?: "png" | "jpeg"; // default: png
  background?: "transparent" | "white" | "black"; // default: transparent
  alphaMatting?: boolean;
  syncMode?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    if (!FAL_KEY) {
      return NextResponse.json(
        { error: "FAL_KEY not configured on server" },
        { status: 500 }
      );
    }

    const {
      image,
      outputFormat = "png",
      background = "transparent",
      alphaMatting = true,
      syncMode = false,
    } = (await req.json()) as RemoveBgBody;

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid `image`" },
        { status: 400 }
      );
    }

    // ——— URL mi, data URI mi? ———
    let imageUrl = image;
    if (image.startsWith("data:")) {
      const [meta, b64] = image.split(",");
      const mimeMatch = /data:(.*?);base64/.exec(meta);
      const mime = (mimeMatch && mimeMatch[1]) || "image/png";
      const bin = Buffer.from(b64, "base64");

      const hasFileCtor = typeof (global as any).File !== "undefined";
      const fileOrBlob = hasFileCtor
        ? new File(
            [bin],
            "removebg-input" + (mime === "image/png" ? ".png" : ".jpg"),
            { type: mime }
          )
        : (new Blob([bin], { type: mime }) as any);

      imageUrl = await fal.storage.upload(fileOrBlob);
    }

    // ——— FAL çağrısı ———
    const result = await fal.subscribe(MODEL_ID, {
      input: {
        image_url: imageUrl,
        output_format: outputFormat,
        background,
        alpha_matting: alphaMatting,
        sync_mode: syncMode,
      },
      logs: false,
    });

    const data: any = (result as any)?.data ?? {};
    const imageObj =
      data?.image ||
      (Array.isArray(data?.images) && data.images.length > 0
        ? data.images[0]
        : undefined);

    const image_url: string | undefined = imageObj?.url;
    const image_data: string | undefined = imageObj?.data;

    if (!image_url && !image_data) {
      return NextResponse.json(
        { error: "removebg failed: no image in response" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      image_url,
      image_data,
      content_type: imageObj?.content_type,
      description: data?.description,
    });
  } catch (err: any) {
    console.error("[/api/removebg] error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
