// app/api/tryon/route.ts
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===== Genel Ayarlar =====
const PROVIDER = (process.env.TRYON_PROVIDER || "eachlabs").toLowerCase(); // default: eachlabs
console.log("TRYON_PROVIDER at runtime:", process.env.TRYON_PROVIDER);
console.log("EACHLABS_KEY exists:", !!process.env.EACHLABS_KEY);


// ===== Yardımcılar =====
async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Vercel Blob'a yükleme (public URL döndürür)
async function uploadPublicUrl(file: File | Blob, filename = "upload.png") {
  const key = `uploads/${Date.now()}-${filename}`;
  const { url } = await put(key, file as any, { access: "public" });
  return url;
}

// ===== Route =====
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const human = form.get("human_image");
    const garment = form.get("garment_image");
    const metaPrompt = String(form.get("meta_prompt") || "");

    if (!(human instanceof File) || !(garment instanceof File)) {
      return NextResponse.json({ error: "Missing files" }, { status: 400 });
    }

    // ===== Eachlabs Nano-Banana =====
    if (PROVIDER === "eachlabs") {
      const EACHLABS_KEY = process.env.EACHLABS_KEY || "";
      const EACHLABS_URL = "https://api.eachlabs.ai/v1/prediction/";

      if (!EACHLABS_KEY) {
        return NextResponse.json({ error: "EACHLABS_KEY missing" }, { status: 401 });
      }

      // 1️⃣ Dosyaları Vercel Blob'a yükle
      const [humanUrl, garmentUrl] = await Promise.all([
        uploadPublicUrl(human, (human as any).name || "human.png"),
        uploadPublicUrl(garment, (garment as any).name || "garment.png"),
      ]);

      const prompt =
        metaPrompt?.trim() ||
        "Realistic try-on; keep body pose, true color, clean e-commerce lighting.";

      // 2️⃣ Prediction oluştur
      const createRes = await fetch(EACHLABS_URL, {
        method: "POST",
        headers: {
          "X-API-Key": EACHLABS_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "nano-banana-edit",
          version: "0.0.1",
          input: {
            image_urls: [humanUrl, garmentUrl],
            num_images: 1,
            prompt,
            output_format: "jpeg",
            sync_mode: false,
            aspect_ratio: "1:1",
            limit_generations: true,
          },
          webhook_url: "",
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok || !createData?.id) {
        return NextResponse.json(
          { error: "Prediction create failed", detail: createData },
          { status: createRes.status || 500 },
        );
      }

      // 3️⃣ Sonucu bekle (poll)
      const id = createData.id;
      let resultData: any = null;

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollRes = await fetch(`${EACHLABS_URL}${id}`, {
          method: "GET",
          headers: { "X-API-Key": EACHLABS_KEY },
        });
        const pollData = await pollRes.json();

        if (pollData?.status === "succeeded") {
          resultData = pollData;
          break;
        }
        if (pollData?.status === "failed") {
          return NextResponse.json(
            { error: "Prediction failed", detail: pollData },
            { status: 500 },
          );
        }
      }

      if (!resultData) {
        return NextResponse.json(
          { error: "Prediction timeout or no result" },
          { status: 504 },
        );
      }

      const imageUrl =
        resultData?.output?.[0]?.url ||
        resultData?.data?.output?.[0]?.url ||
        null;

      if (!imageUrl) {
        return NextResponse.json(
          { error: "No image URL found", raw: resultData },
          { status: 500 },
        );
      }

      return NextResponse.json({ image_url: imageUrl, id });
    }

    // Eğer yanlış provider girildiyse:
    return NextResponse.json(
      { error: `Unknown TRYON_PROVIDER: ${PROVIDER}` },
      { status: 400 },
    );
  } catch (err: any) {
    console.error("[/api/tryon] error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 },
    );
  }
}

