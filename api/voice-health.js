function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-'));
  return json(res, 200, {
    ok: true,
    version: '3.1',
    openaiApiKeyVisibleToDeployment: hasKey,
    note: hasKey
      ? 'OPENAI_API_KEY is present in this Vercel deployment. The natural AI voice endpoint should be able to attempt speech generation.'
      : 'OPENAI_API_KEY is not visible to this Vercel deployment. Add it to this project for the Preview environment and redeploy.'
  });
}
