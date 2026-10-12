# n8n — Send Docket Email

The quotation board's **Send Email** column posts a `multipart/form-data` request
to an n8n Webhook. n8n relays it through a Gmail (OAuth) node, attaching the
generated Offer PDF.

## 1. Import the workflow

1. n8n → **Workflows → Import from File** → select
   `documentation/n8n/send-docket-email.workflow.json`.
2. Open the **Gmail - Send** node and pick (or create) a **Gmail OAuth2**
   credential for the sending account.

## 2. Payload contract

The app (`lib/services/n8nEmail.ts`) sends these form fields:

| Field          | Meaning                                   | Used by         |
| -------------- | ----------------------------------------- | --------------- |
| `to`           | `Enquiry.senderEmail`                     | Gmail **To**    |
| `cc`           | `Enquiry.emailAddress` (comma-separated)  | Gmail **Cc**    |
| `subject`      | Offer subject line                        | Gmail Subject   |
| `html`         | Rendered HTML body                        | Gmail body      |
| `docketNumber` | Docket number (context/logging)           | —               |
| `fileName`     | PDF file name                             | Attachment name |
| `attachment`   | **binary** Offer PDF (`application/pdf`)  | Gmail attachment|

n8n exposes the file as `$binary.attachment` (the form field name) and the text
fields under `$json.body` (e.g. `$json.body.to`, `$json.body.subject`). The
workflow responds `{ "success": true, "messageId": <gmail id> }`.

## 3. Activate + wire the URL

1. **Activate** the workflow (production webhook).
2. Copy the production URL, e.g.
   `https://<your-host>/webhook/send-docket-email`.
3. Put it in the app's `.env` (server-only):

   ```
   N8N_DOCKET_WEBHOOK_URL=https://<your-host>/webhook/send-docket-email
   ```

4. Restart the Next.js server so the new env var is picked up.

## 4. Test without the app

```bash
curl -X POST "https://<your-host>/webhook/send-docket-email" \
  -F "to=buyer@example.com" \
  -F "cc=accounts@example.com" \
  -F "subject=Offer For Supply" \
  -F "html=<p>Hello</p>" \
  -F "docketNumber=GMD-0001" \
  -F "fileName=Offer-GMD-0001.pdf" \
  -F "attachment=@./some-offer.pdf;type=application/pdf"
```

A `200` with `{"success":true,...}` means the app's `sendDocketEmailAction` will
persist `emailSentBy` and lock the row (Reset unlocks it).

## 5. Notes

- **Binary property:** the Gmail node attaches `$binary.attachment`. If your n8n
  version renames multipart files, open the Webhook node, enable the binary
  option, and set the property name to `attachment` (or update the Gmail node's
  attachment property to match).
- **Allowlist:** if the n8n instance restricts webhook origins, allow the app's
  origin (`NEXTAUTH_URL`).
- **Security (optional):** add a Header Auth credential on the Webhook node and
  send a shared secret from `n8nEmail.ts` via `headers` on the `fetch` call.
