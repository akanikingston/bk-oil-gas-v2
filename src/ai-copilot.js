import { createClient } from "@supabase/supabase-js";

// Vercel serverless function — the Anthropic API key lives here only,
// never in the browser bundle. Receives a question + a compact data
// snapshot from the app, asks Claude, returns a plain-text answer.

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const SYSTEM_PROMPT = `You are the AI Copilot inside BK Oil & Gas's internal ERP, used by the
Owner and Manager of an LPG (cooking gas) filling station in Nigeria.

Rules:
- Answer ONLY using the JSON data snapshot provided in the user's message. Never invent numbers.
- If the data needed to answer isn't in the snapshot, say so plainly instead of guessing.
- Use Naira formatting for money (e.g. ₦125,000) and "kg" for quantities.
- Be concise — this is read on a phone. Prefer short paragraphs or a few bullet points over long prose.
- When asked for a "summary" or "recap", write a brief, professional business update: what happened,
  key numbers, and anything that needs attention (shortages, low stock, unusual expenses).
- When asked a direct question, answer it directly first, then add brief supporting detail if useful.
- You are not authorized to change any data — you only read and explain it.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "AI Copilot is not configured yet — missing ANTHROPIC_API_KEY." });
    return;
  }

  let body;
  try {
    body = JSON.parse(await getRawBody(req));
  } catch (e) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const { question, context, userId } = body;
  if (!question || !context) {
    res.status(400).json({ error: "Missing question or context" });
    return;
  }

  // Confirm the caller is a signed-in Owner or Manager before spending API credits.
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (profileError || !profile || (profile.role !== "Owner" && profile.role !== "Manager")) {
      res.status(403).json({ error: "AI Copilot is only available to Owners and Managers." });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "Could not verify permissions." });
    return;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `DATA SNAPSHOT (JSON):\n${JSON.stringify(context)}\n\nQUESTION: ${question}` },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      res.status(502).json({ error: "AI Copilot couldn't get a response. Please try again." });
      return;
    }

    const result = await response.json();
    const answer = (result.content || []).map((block) => block.text || "").join("\n").trim();
    res.status(200).json({ answer: answer || "No response generated." });
  } catch (e) {
    console.error("AI Copilot error:", e.message);
    res.status(500).json({ error: "Something went wrong reaching the AI Copilot." });
  }
}
