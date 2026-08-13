export interface KseEmailLayoutOptions {
  title: string;
  preheader: string;
  body: string;
}

export function buildKseEmailLayout({
  title,
  preheader,
  body,
}: KseEmailLayoutOptions): string {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin:0; padding:0; background-color:#f3f4f6; color:#222222; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${preheader}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background-color:#f3f4f6;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:620px; background-color:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
                <tr>
                  <td style="padding:22px 28px; background-color:#951828; color:#ffffff;">
                    <div style="font-size:13px; font-weight:bold; letter-spacing:1.6px; line-height:1.2;">KSE SUPPLIERS</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 28px 26px;">
                    <h1 style="margin:0 0 24px; color:#951828; font-size:25px; line-height:1.25; font-weight:700;">${title}</h1>
                    ${body}
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 28px; border-top:1px solid #e5e7eb; background-color:#fafafa; color:#6b7280; font-size:12px; line-height:1.5;">
                    KSE Suppliers<br>
                    Thank you for choosing KSE Suppliers.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}
