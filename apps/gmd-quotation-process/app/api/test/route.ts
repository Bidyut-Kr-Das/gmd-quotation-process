import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  console.log("Triggered by scheduler (chronicle)");
  return NextResponse.json(
    {
      triggered: "by scheduler(chronicles)",
    },
    {
      status: 200,
    },
  );
}

export async function GET(request: NextRequest) {
  const baseUrl = process.env.EVOLUTION_API_BASE_URL ?? "http://evolution-api:8080";
  const instance = encodeURIComponent(process.env.EVOLUTION_API_INSTANCE ?? "GMD(BOT)");
  const apikey = process.env.EVOLUTION_API_KEY ?? "";

  // Allow query overrides for manual verification: ?number=...&text=...
  const searchParams = request.nextUrl.searchParams;
  const number = searchParams.get("number") ?? "120363425898868905@g.us";
  const text = searchParams.get("text") ?? "GMD Test: Evolution integration OK - message sent at " + new Date().toISOString();

  try {
    const response = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey,
      },
      body: JSON.stringify({
        number,
        text,
      }),
    });

    const data = await response.json().catch(() => null);

    console.log("[test] Evolution response:", data);

    if (!response.ok) {
      return NextResponse.json(
        {
          message: "Evolution returned error",
          status: response.status,
          data,
        },
        {
          status: response.status,
        },
      );
    }

    return NextResponse.json(
      {
        message: "message sent",
        data,
      },
      {
        status: 200,
      },
    );
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      {
        status: 500,
      },
    );
  }
}
