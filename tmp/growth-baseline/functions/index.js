const PRODUCT_LANDING_HOSTS = new Set(['dynamax.cc', 'www.dynamax.cc']);

async function serveHome(context) {
  const url = new URL(context.request.url);
  if (!PRODUCT_LANDING_HOSTS.has(url.hostname.toLowerCase())) {
    return context.next();
  }

  url.pathname = '/products';
  url.search = '';
  return context.env.ASSETS.fetch(new Request(url, context.request));
}

export const onRequestGet = serveHome;
export const onRequestHead = serveHome;
