import { AccountRequestInput } from './account-request.input';

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
  const subject = `New website account request - ${input.businessName} - ${requestId}`;
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
    html: `
      <h1>New website account request</h1>
      <table cellpadding="6" cellspacing="0" border="0">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
          )
          .join('')}
      </table>
    `,
  };
}

export function buildCustomerAccountRequestEmail(
  input: NormalizedAccountRequest,
  requestId: string,
) {
  const subject = 'We received your KSE account request';
  const text = [
    `Hello ${input.contactName},`,
    '',
    'We received your request for access to KSE Suppliers.',
    'Our team will review your information and contact you after approval.',
    'Submitting this request does not create or activate an account immediately.',
    '',
    `Request ID: ${requestId}`,
  ].join('\n');
  const html = `
    <p>Hello ${escapeHtml(input.contactName)},</p>
    <p>We received your request for access to KSE Suppliers.</p>
    <p>Our team will review your information and contact you after approval.</p>
    <p>Submitting this request does not create or activate an account immediately.</p>
    <p><strong>Request ID:</strong> ${escapeHtml(requestId)}</p>
    <p><strong>Business:</strong> ${escapeHtml(input.businessName)}</p>
    <p><strong>Comments:</strong> ${escapeHtml(input.comments || 'None provided')}</p>
  `;

  return { subject, text, html };
}
