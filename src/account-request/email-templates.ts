import { AccountRequestInput } from './account-request.input';
import { buildKseEmailLayout } from '../email/kse-email-layout';

export type NormalizedAccountRequest = Required<AccountRequestInput>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInternalAccountRequestEmail(
  input: NormalizedAccountRequest,
  requestId: string,
  submittedAt: Date,
) {
  const submittedAtIso = submittedAt.toISOString();
  const subject = `New Website Account Request - ${input.businessName} - ${requestId}`;
  const rows = [
    ['Request ID', requestId],
    ['Applicant type', input.applicantType],
    ['Business name', input.businessName],
    ['Contact name', input.contactName],
    ['Phone', input.phone],
    ['Email address', input.email],
    ['Comments', input.comments || 'None provided'],
    ['Submitted at', submittedAtIso],
  ];

  return {
    subject,
    text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    html: buildKseEmailLayout({
      title: 'New Website Account Request',
      preheader: escapeHtml(subject),
      body: `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
          ${rows
            .map(
              ([label, value]) => `
                <tr>
                  <td style="width:34%; padding:11px 12px 11px 0; border-bottom:1px solid #e5e7eb; color:#4b5563; font-size:13px; line-height:1.4; font-weight:700; vertical-align:top;">${escapeHtml(label)}</td>
                  <td style="padding:11px 0; border-bottom:1px solid #e5e7eb; color:#111827; font-size:14px; line-height:1.4; vertical-align:top;">${escapeHtml(value)}</td>
                </tr>
              `,
            )
            .join('')}
        </table>
      `,
    }),
  };
}

export function buildCustomerAccountRequestEmail(
  input: NormalizedAccountRequest,
) {
  const subject = 'We Received Your KSE Account Request';
  const text = [
    `Hello ${input.contactName},`,
    '',
    'We received your request for access to KSE Suppliers.',
    'Our team will review your information and contact you after approval.',
    'Submitting this request does not create or activate an account immediately.',
  ].join('\n');
  const html = buildKseEmailLayout({
    title: 'We Received Your KSE Account Request',
    preheader: subject,
    body: `
      <p style="margin:0 0 16px; color:#222222; font-size:15px; line-height:1.6;">Hello ${escapeHtml(input.contactName)},</p>
      <p style="margin:0 0 16px; color:#222222; font-size:15px; line-height:1.6;">We received your request for access to KSE Suppliers.</p>
      <p style="margin:0 0 16px; color:#222222; font-size:15px; line-height:1.6;">Our team will review your information and contact you after approval.</p>
      <p style="margin:0 0 24px; color:#222222; font-size:15px; line-height:1.6;">Submitting this request does not create or activate an account immediately.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
        <tr>
          <td colspan="2" style="padding:0 0 10px; color:#951828; font-size:16px; line-height:1.4; font-weight:700;">Request Details</td>
        </tr>
        <tr>
          <td style="width:34%; padding:11px 12px 11px 0; border-bottom:1px solid #e5e7eb; color:#4b5563; font-size:13px; line-height:1.4; font-weight:700; vertical-align:top;">Business</td>
          <td style="padding:11px 0; border-bottom:1px solid #e5e7eb; color:#111827; font-size:14px; line-height:1.4; vertical-align:top;">${escapeHtml(input.businessName)}</td>
        </tr>
        <tr>
          <td style="width:34%; padding:11px 12px 11px 0; color:#4b5563; font-size:13px; line-height:1.4; font-weight:700; vertical-align:top;">Comments</td>
          <td style="padding:11px 0; color:#111827; font-size:14px; line-height:1.4; vertical-align:top;">${escapeHtml(input.comments || 'None provided')}</td>
        </tr>
      </table>
    `,
  });

  return { subject, text, html };
}
