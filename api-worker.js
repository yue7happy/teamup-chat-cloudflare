export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 添加 CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    const backendUrl = 'http://103.217.186.241:3001' + url.pathname + url.search;
    
    try {
      const response = await fetch(backendUrl, {
        method: request.method,
        headers: {
          ...Object.fromEntries(request.headers),
          'Host': '103.217.186.241:3001',
        },
        body: request.body,
      });
      
      // 复制响应并添加 CORS 头
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  }
};
