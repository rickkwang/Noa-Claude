#!/usr/bin/env bun
/**
 * Simple Mock Anthropic API Server
 */

const PORT = 8080;

Bun.serve({
  port: PORT,
  fetch(req: Request) {
    const url = new URL(req.url);
    console.log(`[Mock] ${req.method} ${url.pathname}`);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
    }

    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      return handleMessages(req);
    }
    
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return Response.json({ data: [{ id: 'claude-sonnet-4-20250514' }] }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    
    if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
      return Response.json({ input_tokens: 10, output_tokens: 0 }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  }
});

async function handleMessages(req: Request) {
  try {
    const body = await req.json();
    const auth = req.headers.get('Authorization') || '';
    const apiKey = auth.replace('Bearer ', '');
    
    console.log(`[Mock] API Key: ${apiKey}, Body model: ${body.model}`);
    
    if (apiKey !== 'mock-key') {
      return Response.json({ type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } }, { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // Extract message
    let text = 'Mock response';
    if (body.messages) {
      for (const msg of body.messages) {
        if (msg.role === 'user') {
          const content = msg.content;
          if (typeof content === 'string') text = content;
          else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') text = block.text;
            }
          }
        }
      }
    }

    const response = {
      id: `mock_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: `[Mock] ${text.slice(0, 100)}` }],
      model: body.model || 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    return Response.json(response, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    console.error('[Mock] Error:', e);
    return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: String(e) } }, { status: 400 });
  }
}

console.log(`[Mock] Server on http://localhost:${PORT}`);
