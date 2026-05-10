/**
 * Programmatic Page Generator
 *
 * Deterministic, no-LLM page template generation for location + service pages.
 * Designed for high-volume programmatic SEO (city + service, neighborhood + service, etc.).
 *
 * Output is clean, schema-rich HTML + metadata ready for static generation or CMS injection.
 */

function normalize(input) {
  return String(input || '').trim();
}

function slugify(str) {
  return normalize(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(str) {
  return normalize(str).replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generate a location + service page template.
 */
function generateLocationServicePage({
  businessName,
  city,
  state,
  service,
  industry,
  phone = '',
  address = '',
  yearsInBusiness = '',
  schemaType = 'LocalBusiness'
}) {
  const safeCity = titleCase(city);
  const safeState = state.toUpperCase();
  const safeService = titleCase(service);
  const safeIndustry = titleCase(industry || service);
  const safeName = normalize(businessName) || `${safeService} in ${safeCity}`;

  const slug = slugify(`${safeService} ${safeCity} ${safeState}`);
  const title = `${safeService} in ${safeCity}, ${safeState} | ${safeName}`;
  const metaDesc = `Expert ${safeService.toLowerCase()} in ${safeCity}, ${safeState}. ${yearsInBusiness ? `${yearsInBusiness} years serving the area. ` : ''}Call ${phone || 'today'} for fast, reliable service.`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: safeName,
    address: address ? {
      '@type': 'PostalAddress',
      streetAddress: address,
      addressLocality: safeCity,
      addressRegion: safeState
    } : undefined,
    telephone: phone || undefined,
    areaServed: {
      '@type': 'City',
      name: safeCity
    },
    description: metaDesc
  };

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${metaDesc}">
  <link rel="canonical" href="https://example.com/${slug}">
  <script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>
</head>
<body>
  <header>
    <h1>${safeService} in ${safeCity}, ${safeState}</h1>
    ${phone ? `<a href="tel:${phone.replace(/[^\d+]/g, '')}" class="cta-phone">${phone}</a>` : ''}
  </header>

  <main>
    <section>
      <h2>Professional ${safeService} Services in ${safeCity}</h2>
      <p>${safeName} has been providing trusted ${safeService.toLowerCase()} throughout ${safeCity} and the surrounding ${safeState} area${yearsInBusiness ? ` for ${yearsInBusiness}` : ''}.</p>
    </section>

    <section>
      <h2>Why Choose Us for ${safeService} in ${safeCity}?</h2>
      <ul>
        <li>Local experts who know ${safeCity} inside and out</li>
        <li>Fast response times across the ${safeCity} metro</li>
        <li>Transparent pricing with no hidden fees</li>
        <li>Fully licensed, bonded, and insured</li>
      </ul>
    </section>

    <section>
      <h2>Service Areas</h2>
      <p>We proudly serve all neighborhoods in ${safeCity} and nearby communities in ${safeState}.</p>
    </section>
  </main>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${safeName}. All rights reserved.</p>
  </footer>
</body>
</html>`;

  return {
    slug,
    title,
    metaDescription: metaDesc,
    html,
    schema,
    url: `https://example.com/${slug}`
  };
}

module.exports = {
  generateLocationServicePage,
  slugify,
  titleCase
};