import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Vercel serverless function — runs on the server, never in the browser.
// Receives transaction webhooks from Moniepoint and stores confirmed
// (approved) transactions in Supabase so the app can show a synced POS total.

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawBody = await getRawBody(req);
  const webhookId = req.headers["moniepoint-webhook-id"];
  const timestamp = req.headers["moniepoint-webhook-timestamp"];
  const signature = req.headers["moniepoint-webhook-signature"];
  const secret = process.env.MONIEPOINT_WEBHOOK_SECRET;

  if (!secret) {
    console.error("MONIEPOINT_WEBHOOK_SECRET is not set in Vercel env vars");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }
  if (!webhookId || !timestamp || !signature) {
    res.status(400).json({ error: "Missing Moniepoint signature headers" });
    return;
  }

  // Per Moniepoint's docs: signature = HMAC-SHA256(secret, `${id}__${timestamp}__${rawBody}`), base64-encoded
  const data = `${webhookId}__${timestamp}__${rawBody}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest("base64");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  const isValid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!isValid) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const tx = payload.data || {};
  const eventType = payload.eventType || "";

  // Only store settled/approved transactions — ignore PENDING/FAILED noise.
  // NOTE: confirm against a real sandbox transaction whether Moniepoint uses
  // "APPROVED", "SUCCESSFUL", or a responseCode like "00" for success — adjust
  // this check if your test transactions don't show up.
  const isSettled = tx.transactionStatus === "APPROVED" || tx.transactionStatus === "SUCCESSFUL" || tx.responseCode === "00";

  if (isSettled) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // NOTE: Moniepoint amounts are commonly in kobo (e.g. 25300 = ₦253.00),
    // matching other Nigerian payment APIs. Confirm against a real transaction
    // and remove the "/ 100" below if amounts already arrive in naira.
    const { error } = await supabase.from("pos_transactions").upsert(
      {
        transaction_reference: tx.transactionReference || payload.eventId,
        terminal_serial: tx.terminalSerial || null,
        amount: (Number(tx.amount) || 0) / 100,
        transaction_type: tx.transactionType || eventType,
        status: tx.transactionStatus || null,
        transaction_time: tx.transactionTime || payload.createdAt || new Date().toISOString(),
        raw_payload: payload,
      },
      { onConflict: "transaction_reference" }
    );

    if (error) {
      console.error("Failed to store Moniepoint transaction:", error.message);
      res.status(500).json({ error: "Failed to store transaction" });
      return;
    }
  }

  res.status(200).json({ received: true });
}
