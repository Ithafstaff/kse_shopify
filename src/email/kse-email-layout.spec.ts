import { buildKseEmailLayout } from './kse-email-layout';

describe('buildKseEmailLayout', () => {
  it('renders the shared KSE shell around the supplied content', () => {
    const html = buildKseEmailLayout({
      title: 'Shipping Quote Request Received',
      preheader: 'Shipping Quote Request Received - Order #D1001',
      body: '<p>Body content</p>',
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('KSE SUPPLIERS');
    expect(html).toContain('Shipping Quote Request Received');
    expect(html).toContain('Shipping Quote Request Received - Order #D1001');
    expect(html).toContain('<p>Body content</p>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('background-color:#951828');
    expect(html).toContain('background-color:#ffffff');
    expect(html).toContain('KSE Suppliers');
  });
});
