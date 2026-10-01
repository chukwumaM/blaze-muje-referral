# Blaze Digital Asset Check — Integration Setup

The page submits to `/.netlify/functions/submit-lead`.

## Netlify environment variables

Add these under Netlify → Project configuration → Environment variables:

- `BLAZE_TEAM_EMAIL` — Blaze team inbox that should receive every new lead.
- `GOOGLE_SCRIPT_URL` — Google Apps Script Web App URL for the lead sheet.
- `RESEND_API_KEY` — Resend API key for transactional email.
- `RESEND_FROM` — verified sender, for example `Blaze Exchange <leads@yourdomain.com>`.
- `TWILIO_ACCOUNT_SID` — Twilio Account SID.
- `TWILIO_AUTH_TOKEN` — Twilio Auth Token.
- `TWILIO_WHATSAPP_FROM` — approved WhatsApp sender in `whatsapp:+...` format.
- `TWILIO_CONTENT_SID` — approved WhatsApp template Content SID for new outbound conversations.

## What happens on a submission

1. The browser sends the lead to the Netlify Function.
2. The function validates required fields and ignores honeypot bot submissions.
3. The lead is forwarded to the Google Apps Script sheet endpoint when configured.
4. The Blaze team receives an email when Resend is configured.
5. The lead receives a confirmation email when an email address was provided.
6. The lead receives a WhatsApp message when Twilio is configured. For new outbound WhatsApp conversations, use an approved template via `TWILIO_CONTENT_SID`.

## Security

Never put API keys in `index.html` or any browser-side JavaScript. Keep all secrets in Netlify environment variables.

Do not collect passwords, PINs, wallet seed phrases, private keys or other authentication secrets through this form.
