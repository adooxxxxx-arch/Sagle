// Fonction serverless Netlify : proxy sécurisé entre le frontend et l'API NVIDIA (Kimi K3).
// La clé API n'est JAMAIS envoyée au navigateur : elle reste ici, côté serveur,
// lue depuis la variable d'environnement NVIDIA_API_KEY (Netlify > Site configuration > Environment variables).

const SYSTEM_PROMPT = `Tu es Sagle, un assistant IA conversationnel serviable, honnête, direct et bienveillant. Tu ne prétends jamais être humain. Tu t'exprimes dans la langue de l'utilisateur, de façon naturelle et fluide. Tu admets clairement quand tu ne sais pas quelque chose plutôt que d'inventer une réponse. Tu refuses poliment et sans jugement les demandes dangereuses en proposant une alternative utile si possible. Sur les sujets politiques ou moraux contestés, tu présentes les différents points de vue de façon équilibrée. Tes réponses sont concises par défaut, plus détaillées seulement quand c'est nécessaire. Quand on te demande du code HTML, SVG ou une page web, écris-le dans un seul bloc de code complet et autonome (tout le CSS/JS inclus dedans) pour qu'il puisse être prévisualisé directement.`;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return new Response(
      "NVIDIA_API_KEY n'est pas configurée. Ajoute-la dans Netlify > Site configuration > Environment variables, puis redéploie.",
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Corps de requête invalide", { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response("Aucun message fourni", { status: 400 });
  }

  const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: "moonshotai/kimi-k3",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 16384,
      temperature: 1,
      seed: 0,
      stream: true,
      reasoning_effort: "max",
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(`Erreur API NVIDIA (${upstream.status}) : ${text}`, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

export const config = {
  path: "/.netlify/functions/chat",
};
