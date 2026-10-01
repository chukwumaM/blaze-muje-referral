const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    return { ok: false, skipped: true, reason: "email_not_configured" };
  }

  const from = process.env.RESEND_FROM || "Blaze Exchange <onboarding@resend.dev>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend error: ${response.status} ${await response.text()}`);
  }

  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, message: "Method not allowed" });
  }

  try {
    const data = JSON.parse(event.body || "{}");

    if (clean(data["bot-field"], 50)) {
      return json(200, { ok: true });
    }

    const lead = {
      asset: clean(data.asset),
      amount: clean(data.amount),
      intent: clean(data.intent),
      name: clean(data.name, 120),
      whatsapp: clean(data.whatsapp, 40),
      email: clean(data.email, 160),
      source: clean(data.source || "direct", 120),
      submitted_at: new Date().toISOString(),
      page: clean(data.page, 300),
    };

    if (!lead.asset || !lead.amount || !lead.intent || !lead.name || !lead.whatsapp) {
      return json(400, {
        ok: false,
        message: "Please complete all required fields.",
      });
    }

    const teamEmail = process.env.BLAZE_TEAM_EMAIL;

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#171717">
        <div style="background:#ff6a00;padding:20px;border-radius:12px 12px 0 0;color:white">
          <h2 style="margin:0">New Blaze Digital Asset Check</h2>
        </div>
        <div style="padding:24px;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px">
          <p><strong>Name:</strong> ${lead.name}</p>
          <p><strong>WhatsApp:</strong> ${lead.whatsapp}</p>
          <p><strong>Email:</strong> ${lead.email || "Not provided"}</p>
          <p><strong>Asset:</strong> ${lead.asset}</p>
          <p><strong>Amount:</strong> ${lead.amount}</p>
          <p><strong>Intent:</strong> ${lead.intent}</p>
          <p><strong>Source:</strong> ${lead.source}</p>
          <p><strong>Submitted:</strong> ${lead.submitted_at}</p>
          <hr>
          <p style="color:#666;font-size:13px">Do not request or store passwords, PINs, wallet seed phrases or private keys.</p>
        </div>
      </div>
    `;

    const leadEmailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#171717">
        <h2>We received your Digital Asset Check</h2>
        <p>Hi ${lead.name},</p>
        <p>Thanks for submitting your Digital Asset Check to Blaze Exchange.</p>
        <p>We received your enquiry about <strong>${lead.asset}</strong>. Our team will review the information you provided and follow up with you.</p>
        <p>If you need to reach us directly, you can reply to this email or contact Blaze Exchange through your usual channel.</p>
        <p style="color:#666;font-size:13px">Please do not send passwords, PINs, seed phrases or private keys.</p>
        <p>— Blaze Exchange</p>
      </div>
    `;

    const results = await Promise.allSettled([
      sendEmail({
        to: teamEmail,
        subject: `New Digital Asset Check — ${lead.name}`,
        html: emailHtml,
      }),
      lead.email
        ? sendEmail({
            to: lead.email,
            subject: "We received your Blaze Digital Asset Check",
            html: leadEmailHtml,
          })
        : Promise.resolve({ ok: false, skipped: true, reason: "lead_email_not_provided" }),
    ]);

    const successful = results.filter(
      (result) => result.status === "fulfilled" && result.value?.ok === true
    );

    const rejected = results.filter((result) => result.status === "rejected");
    rejected.forEach((result) => console.error("Lead email failed:", result.reason));

    if (successful.length === 0) {
      return json(502, {
        ok: false,
        message: "Email delivery is not configured yet. Please try again later.",
      });
    }

    return json(200, {
      ok: true,
      message: "Your Digital Asset Check was submitted successfully.",
    });
  } catch (error) {
    console.error(error);
    return json(500, {
      ok: false,
      message: "We could not submit your check right now. Please try again in a moment.",
    });
  }
};
