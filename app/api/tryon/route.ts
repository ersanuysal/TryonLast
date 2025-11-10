// app/api/tryon/route.ts
import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bu sürüm Eachlabs Nano-Banana API’sine göre güncellendi.
 * Varsayılan PROVIDER artık "eachlabs".
 * Görselleri URL’e çevirmek için mevcut FAL storage uploader kullanılıyor.
 * (İstersen bunu Vercel Blob/S3 ile değiştirebilirsin.)
 */

// ===== Genel Ayarlar =====
const PROVIDER = (process.env.TRYON_PROVIDER || "eachlabs").toLowerCase(); // "eachlabs" | "fal" | "nanobanana"

// FAL storage upload için gerekli olabilir (only if used as uploader)
fal.config({ credentials: process.env.FAL_KEY || "" });

// ===== Yardımcılar =====
async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// FAL storage'a dosya yükleyip erişilebilir URL döndürür (uploader olarak kullanıyoruz)
async function uploadToFal(file: File | Blob, filename = "upload.png") {
  const wrapped =
    file instanceof File
      ? file
      : new File([file], filename, { type: (file as any).type || "image/png" });
  return await fal.storage.upload(wrapped);
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

    // ========== 1) Eachlabs Nano-Banana (varsayılan) ==========
    if (PROVIDER === "eachlabs") {
      const EACHLABS_KEY = process.env.EACHLABS_KEY || "";
      const EACHLABS_URL = "https://api.eachlabs.ai/v1/prediction/";

      if (!EACHLABS_KEY) {
        return NextResponse.json({ error: "EACHLABS_KEY missing" }, { status: 401 });
      }

      // Dosyaları erişilebilir URL’e çevir (hızlı çözüm: FAL storage)
      const [humanUrl, garmentUrl] = await Promise.all([
        uploadToFal(human, (human as any).name || "human.png"),
        uploadToFal(garment, (garment as any).name || "garment.png"),
      ]);

      const prompt =
        metaPrompt?.trim() ||
        "Realistic try-on; keep body pose, true color, clean e-commerce lighting.";

      // 1) Prediction oluştur
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
            sync_mode: false, // dokümana göre polling
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

      // 2) Poll ile bekle
      const id = createData.id;
      let resultData: any = null;

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000)); // 3 sn arayla
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

    // ========== 2) FAL / Nano-Banana (opsiyonel; istersen kullan) ==========
    if (PROVIDER === "fal") {
      if (!process.env.FAL_KEY) {
        return NextResponse.json({ error: "FAL_KEY missing" }, { status: 401 });
      }

      const [humanUrl, garmentUrl] = await Promise.all([
        uploadToFal(human, (human as any).name || "human.png"),
        uploadToFal(garment, (garment as any).name || "garment.png"),
      ]);

      const prompt =
        metaPrompt?.trim() ||
        "Dress the person with the garment realistically; preserve body/pose; consistent lighting; e-commerce look.";

      const out = await fal.subscribe("fal-ai/nano-banana/edit", {
        input: { prompt, image_urls: [humanUrl, garmentUrl] },
        logs: false,
      });

      const url =
        (out as any)?.data?.images?.[0]?.url ||
        (out as any)?.data?.image?.url ||
        (out as any)?.images?.[0]?.url;

      if (!url) {
        return NextResponse.json(
          { error: "No image from FAL nano-banana/edit", raw: out },
          { status: 500 },
        );
      }
      return NextResponse.json({ image_url: url });
    }

    // ========== 3) Harici Nano-Banana Proxy (multipart) ==========
    if (PROVIDER === "nanobanana") {
      const NB_BASE = process.env.NANOBANANA_API_URL || "https://api.nano-banana.example.com";
      const NB_KEY = process.env.NANOBANANA_API_KEY || "";

      if (!NB_BASE || !NB_KEY) {
        return NextResponse.json(
          { error: "NANOBANANA_API_URL or NANOBANANA_API_KEY missing" },
          { status: 401 },
        );
      }

      const fd = new FormData();
      fd.append("human_image", human, (human as any).name || "human.png");
      fd.append("garment_image", garment, (garment as any).name || "garment.png");
      if (metaPrompt) fd.append("prompt", metaPrompt);

      const res = await fetch(`${NB_BASE}/v1/try-on`, {
        method: "POST",
        headers: { Authorization: `Bearer ${NB_KEY}` },
        body: fd,
      });

      if (!res.ok) {
        const errJson = await safeJson(res);
        const msg = errJson?.error || errJson?.message || `Nano-Banana error (${res.status})`;
        return NextResponse.json({ error: msg, detail: errJson }, { status: res.status });
      }

      const data = await safeJson(res);
      const imageUrl =
        data?.image_url ||
        data?.result?.url ||
        data?.data?.image_url ||
        data?.data?.image?.url;

      if (!imageUrl) {
        return NextResponse.json(
          { error: "No image_url in Nano-Banana response", raw: data },
          { status: 500 },
        );
      }
      return NextResponse.json({ image_url: imageUrl });
    }

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
