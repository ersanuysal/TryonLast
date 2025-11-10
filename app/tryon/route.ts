import { NextResponse } from "next/server";

const EACHLABS_URL = "https://api.eachlabs.ai/v1/prediction/";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { model_image, garment_image, prompt } = body;

    const EACHLABS_KEY = process.env.EACHLABS_KEY;

    if (!EACHLABS_KEY) {
      return NextResponse.json(
        { error: "EACHLABS_KEY missing. Set it in .env.local" },
        { status: 401 }
      );
    }

    // 1️⃣ Yeni prediction oluştur
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
          image_urls: [model_image, garment_image],
          num_images: 1,
          prompt:
            prompt ||
            "Studio-quality AI fashion try-on. Maintain pose, realistic garment fit, true color, soft lighting.",
          output_format: "jpeg",
          sync_mode: false,
          aspect_ratio: "1:1",
          limit_generations: true,
        },
        webhook_url: "",
      }),
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return NextResponse.json(
        { error: "Prediction create failed", detail: createData },
        { status: createRes.status }
      );
    }

    const predictionId = createData?.id;
    if (!predictionId) {
      return NextResponse.json(
        { error: "No prediction ID returned", raw: createData },
        { status: 500 }
      );
    }

    // 2️⃣ Sonucu bekle (polling)
    let resultData = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000)); // 3 sn arayla kontrol et
      const pollRes = await fetch(`${EACHLABS_URL}${predictionId}`, {
        method: "GET",
        headers: {
          "X-API-Key": EACHLABS_KEY,
        },
      });

      const pollData = await pollRes.json();

      if (pollData?.status === "succeeded") {
        resultData = pollData;
        break;
      } else if (pollData?.status === "failed") {
        return NextResponse.json(
          { error: "Prediction failed", detail: pollData },
          { status: 500 }
        );
      }
    }

    if (!resultData) {
      return NextResponse.json(
        { error: "Prediction timeout or no result" },
        { status: 504 }
      );
    }

    const imageUrl =
      resultData?.output?.[0]?.url ||
      resultData?.data?.output?.[0]?.url ||
      null;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No image URL found in result", raw: resultData },
        { status: 500 }
      );
    }

    return NextResponse.json({ image_url: imageUrl, id: predictionId });
  } catch (err: any) {
    console.error("tryon route error:", err?.message || err);
    return NextResponse.json(
      { error: "Server error", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
