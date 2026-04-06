export default async function handler(request, context) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api/, '');
  const backendUrl = 'http://103.217.186.241:3001' + pathname + url.search;
  
  const response = await fetch(backendUrl, {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      ...request.headers
    },
    body: request.method !== 'GET' ? await request.text() : undefined
  });
  
  const data = await response.json();
  
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}