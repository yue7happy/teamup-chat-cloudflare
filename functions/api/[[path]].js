export async function onRequest(context) {
  const BACKEND = 'http://103.217.186.241:3001';
  const url = new URL(context.request.url);
  
  const backendUrl = BACKEND + url.pathname + url.search;
  
  const response = await fetch(backendUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });
  
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...response.headers,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
