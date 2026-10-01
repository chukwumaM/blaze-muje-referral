const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function normaliseWhatsApp(value) {
  const raw = clean(value, 40).replace(/[^\d+]/g, "");
  if (raw.startsWith("00")) return raw.slice(2);
  if (raw.startsWith("+")) return raw.slice(1);
  if (raw.startsWith("0")) return `234${raw.slice(1)}`;
  return raw;
}

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return { ok: false, skipped: true, reason: "email_not_configured" };

  const from = process.env.RESEND_FROM || "Blaze Exchange <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend error: ${response.status} ${text}`);
  }
  return { ok: true };
}

async function sendWhatsApp(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from || !to) {
    return { ok: false, skipped: true, reason: "whatsapp_not_configured" };
  }

  const params = new URLSearchParams({ from, to: `whatsapp:+${to}`, body });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio error: ${response.status} ${text}`);
  }
  return { ok: true };
}

async function saveToGoogleSheet(payload) {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) return { ok: false, skipped: true, reason: "google_sheet_not_configured" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Apps Script web apps sometimes return a redirect or a text response. We only
  // need to know that the request was accepted; do not expose provider details.
  if (!response.ok && response.status !== 302) {
    const text = await response.text();
    throw new Error(`Google Apps Script error: ${response.status} ${text}`);
  }
  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, message: "Method not allowed" });

  try {
    const data = JSON.parse(event.body || "{}");

    // Honeypot: silently accept bots without creating a lead.
    if (clean(data["bot-field"], 50)) return json(200, { ok: true });

    const lead = {
      asset: clean(data.asset),
      amount: clean(data.amount),
      intent: clean(data.intent),
      name: clean(data.name, 120),
      whatsapp: normaliseWhatsApp(data.whatsapp),
      email: clean(data.email, 160),
      source: clean(data.source || "direct", 120),
      submitted_at: new Date().toISOString(),
      page: clean(data.page, 300),
    };

    if (!lead.asset || !lead.amount || !lead.intent || !lead.name || !lead.whatsapp) {
      return json(400, { ok: false, message: "Please complete all required fields." });
    }

    const teamEmail = process.env.BLAZE_TEAM_EMAIL;
    const leadEmail = lead.email;
    const whatsappText = `Hi ${lead.name}, this is Blaze Exchange. We received your Digital Asset Check for ${lead.asset}. Our team will review the details and get back to you shortly. Please do not send passwords, PINs, seed phrases or private keys.`;

    const emailHtml = `
      <h2>New Blaze Digital Asset Check</h2>
      <p><strong>Name:</strong> ${lead.name}</p>
      <p><strong>WhatsApp:</strong> ${lead.whatsapp}</p>
      <p><strong>Email:</strong> ${lead.email || "Not provided"}</p>
      <p><strong>Asset:</strong> ${lead.asset}</p>
      <p><strong>Amount:</strong> ${lead.amount}</p>
      <p><strong>Intent:</strong> ${lead.intent}</p>
      <p><strong>Source:</strong> ${lead.source}</p>
      <p><strong>Submitted:</strong> ${lead.submitted_at}</p>
      <hr>
      <p>Do not request or store passwords, PINs, wallet seed phrases or private keys.</p>
    `;

    const results = await Promise.allSettled([
      saveToGoogleSheet(lead),
      sendEmail({ to: teamEmail, subject: `New Digital Asset Check — ${lead.name}`, html: emailHtml }),
      leadEmail
        ? sendEmail({
            to: leadEmail,
            subject: "We received your Blaze Digital Asset Check",
            html: `<p>Hi ${lead.name},</p><p>We received your Digital Asset Check for <strong>${lead.asset}</strong>.</p><p>The Blaze team will review your enquiry and follow up with you.</p><p>Please do not send passwords, PINs, seed phrases or private keys.</p><p>— Blaze Exchange</p>`,
          })
        : Promise.resolve({ ok: false, skipped: true, reason: "lead_email_not_provided" }),
      sendWhatsApp(lead.whatsapp, whatsappText),
    ]);

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === results.length) {
      console.error("All lead integrations failed", failed);
      return json(502, { ok: false, message: "We could not submit your check right now. Please try again in a moment." });
    }

    failed.forEach((r) => console.error("Lead integration failed", r.reason));
    return json(200, { ok: true, message: "Your Digital Asset Check was submitted successfully." });
  } catch (error) {
    console.error(error);
    return json(500, { ok: false, message: "We could not submit your check right now. Please try again in a moment." });
  }
};
