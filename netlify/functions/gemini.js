// Proxies requests to Google's Gemini API, but accepts the same request shape
// the app already sends (model / max_tokens / system / messages, Anthropic
// Messages API style) and returns the same response shape
// ({ content: [{ type: "text", text }] }), so the frontend didn't need a
// rewrite — just a different fetch URL.
//
// The Gemini API key lives only here, server-side. It is never sent to the
// browser.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error("GEMINI_API_KEY is missing from environment variables");
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "Server is missing GEMINI_API_KEY. Set it in Netlify's environment variables." }] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { system, messages = [], max_tokens = 1000 } = body;

  const toParts = (content) => {
    if (typeof content === "string") return [{ text: content }];
    if (Array.isArray(content)) {
      return content.map((block) => {
        if (block.type === "image") {
          return {
            inline_data: {
              mime_type: block.source?.media_type || "image/jpeg",
              data: block.source?.data || "",
            },
          };
        }
        return { text: block.text || "" };
      });
    }
    return [{ text: String(content ?? "") }];
  };

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toParts(m.content),
  }));

  const generationConfig = {
    maxOutputTokens: Math.max(max_tokens, 2048),
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (system && /ONLY valid JSON/i.test(system)) {
    generationConfig.responseMimeType = "application/json";
  }

  const payload = { contents, generationConfig };
  if (system) payload.system_instruction = { parts: [{ text: system }] };

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const message = data?.error?.message || `Gemini API error (${geminiRes.status})`;console.error("Gemini API error:", geminiRes.status, JSON.stringify(data));
      return new Response(JSON.stringify({ content: [{ type: "text", text: `Error: ${message}` }] }), {
        status: geminiRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .filter(Boolean)
      .join("\n");

    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) { console.error("Function crashed:", err.message);
    return new Response(JSON.stringify({ content: [{ type: "text", text: `Error: ${err.message}` }] }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
