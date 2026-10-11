// The Cloudflare side of the site. Cloudflare Pages serves the web app's
// files; this code runs in front of them and decides, per request, whether
// the answer is a file or has to come from the real server.
//
//   /v1/*  /i/*  /s/*   -> the server (API, shared files, share pages)
//   everything else     -> the web app
//
// The visitor only ever sees this address, so sign-in cookies are first-party
// and nobody needs to know where the server is.
//
// Two settings of the Pages project, both stored as encrypted secrets:
//   ORIGIN_URL     where the server is, e.g. https://origin.example.com
//   ORIGIN_SECRET  sent on every request; the server ignores anyone without it
//
// Put it online with deploy/setup-cloudflare.sh.

const TO_SERVER = /^\/(v1|i|s)\//

export default {
  async fetch(request, env) {
    const asked = new URL(request.url)

    if (!TO_SERVER.test(asked.pathname)) {
      const file = await env.ASSETS.fetch(request)
      // Any path the web app handles itself (/trash, /settings) is not a
      // file; answer with the app and let it route.
      if (file.status === 404 && request.method === 'GET') {
        return env.ASSETS.fetch(new Request(new URL('/', asked), request))
      }
      return file
    }

    if (!env.ORIGIN_URL || !env.ORIGIN_SECRET) {
      return Response.json({ error: 'this address is not connected to its server yet' }, { status: 503 })
    }

    // Same method, headers and body as the visitor sent, to the other address.
    const upstream = new Request(new URL(asked.pathname + asked.search, env.ORIGIN_URL), request)
    upstream.headers.set('X-Origin-Auth', env.ORIGIN_SECRET)

    try {
      // "manual": a redirect from the server (after sign-in, say) goes back
      // to the browser, which follows it at this address.
      return await fetch(upstream, { redirect: 'manual' })
    } catch {
      return Response.json(
        { error: 'the server is restarting, try again in a minute' },
        { status: 502, headers: { 'Retry-After': '30' } },
      )
    }
  },
}
