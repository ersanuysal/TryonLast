// app/api/tryon/route.ts
import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// -------- Ayarlar --------
const PROVIDER = (process.env.TRYON_PROVIDER || "fal").toLowerCase(); // default: fal
fal.config({ credentials: process.env.FAL_KEY || "" });

// -------- Yardımcılar --------
async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}
async function uploadToFal(file: File | Blob, filename = "upload.png") {
  const wrapped =
    file instanceof File ? file : new File([file], filename, { type: (file as any).type || "image/png" });
  // Not: FAL client binary verirsen otomatik de upload edebilir; burada açıkça upload ediyoruz.
  return await fal.storage.upload(wrapped);
}

// -------- Route --------
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const human = form.get("human_image");
    const garment = form.get("garment_image");
    const metaPrompt = String(form.get("meta_prompt") || "");

    if (!(human instanceof File) || !(garment instanceof File)) {
      return NextResponse.json({ error: "Missing files" }, { status: 400 });
    }

    // ====== 1) FAL / Nano-Banana (ÖNERİLEN) ======
    if (PROVIDER === "fal") {
      // İki görseli FAL storage'a yükle
      const [humanUrl, garmentUrl] = await Promise.all([
        uploadToFal(human, (human as any).name || "human.png"),
        uploadToFal(garment, (garment as any).name || "garment.png"),
      ]);

      // Try-on bağlamı için prompt'u genişlet
      const prompt =
        metaPrompt?.trim()
          ? metaPrompt
          : "Dress the person with the garment realistically; preserve body/pose; consistent lighting; e-commerce look.";

      // Fal Nano-Banana edit (multi-image) çağrısı
      const out = await fal.subscribe("fal-ai/nano-banana/edit", {
        input: {
          prompt,
          image_urls: [humanUrl, garmentUrl], // çoklu görsel
          // num_images: 1,
          // output_format: "jpeg",
          // sync_mode: false, // URL dönmesi daha iyi
        },
        logs: false,
      });

      const url =
        (out as any)?.data?.images?.[0]?.url ||
        (out as any)?.data?.image?.url ||
        (out as any)?.images?.[0]?.url;

      if (!url) {
        return NextResponse.json({ error: "No image from FAL nano-banana/edit" }, { status: 500 });
      }
      return NextResponse.json({ image_url: url });
    }

    // ====== 2) Harici Nano-Banana HTTP proxy (opsiyonel) ======
    if (PROVIDER === "nanobanana") {
      const NB_BASE = process.env.NANOBANANA_API_URL || "https://api.nano-banana.example.com";
      const NB_KEY = process.env.NANOBANANA_API_KEY || "";

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
        return NextResponse.json({ error: msg }, { status: res.status });
      }

      const data = await safeJson(res);
      const imageUrl =
        data?.image_url ||
        data?.result?.url ||
        data?.data?.image_url ||
        data?.data?.image?.url;

      if (!imageUrl) {
        return NextResponse.json({ error: "No image_url in Nano-Banana response" }, { status: 500 });
      }
      return NextResponse.json({ image_url: imageUrl });
    }

    return NextResponse.json({ error: `Unknown TRYON_PROVIDER: ${PROVIDER}` }, { status: 400 });
  } catch (err: any) {
    console.error("[/api/tryon] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
