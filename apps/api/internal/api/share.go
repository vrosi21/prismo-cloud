package api

import "html/template"

// The share page is rendered by the server, not the web app: chat apps fetch
// a link without running JavaScript, so the preview tags must be in the HTML.
var sharePageTmpl = template.Must(template.New("share").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} · Prismo Cloud</title>
<meta name="theme-color" content="#f48fb1">
<meta property="og:site_name" content="Prismo Cloud">
<meta property="og:title" content="{{.Title}}">
<meta property="og:url" content="{{.PageURL}}">
{{- if .IsVideo}}
<meta property="og:type" content="video.other">
<meta property="og:video" content="{{.VideoURL}}">
<meta property="og:video:secure_url" content="{{.VideoURL}}">
<meta property="og:video:type" content="{{.VideoMime}}">
{{- if .Width}}
<meta property="og:video:width" content="{{.Width}}">
<meta property="og:video:height" content="{{.Height}}">
{{- end}}
{{- if .ThumbURL}}
<meta property="og:image" content="{{.ThumbURL}}">
{{- end}}
<meta name="twitter:card" content="player">
{{- else if .IsImage}}
<meta property="og:type" content="website">
<meta property="og:image" content="{{.RawURL}}">
{{- if .Width}}
<meta property="og:image:width" content="{{.Width}}">
<meta property="og:image:height" content="{{.Height}}">
{{- end}}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{{.RawURL}}">
{{- else}}
<meta property="og:type" content="website">
{{- end}}
<style>
  :root { --bg:#f6d54a; --panel:#fff3b8; --ink:#2a1a3e; --accent:#f48fb1; --px:4px; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#140f2d; --panel:#231a4d; --ink:#f4ecff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px;
         background:var(--bg); color:var(--ink);
         font:16px/1.5 ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; }
  main { width:100%; max-width:960px; display:grid; gap:20px; justify-items:center; }
  .frame { background:var(--panel); padding:12px; max-width:100%;
           box-shadow: 0 calc(-1*var(--px)) 0 0 var(--ink), 0 var(--px) 0 0 var(--ink),
                       calc(-1*var(--px)) 0 0 0 var(--ink), var(--px) 0 0 0 var(--ink),
                       0 calc(var(--px)*3) 0 0 var(--accent); }
  .frame img, .frame video { display:block; max-width:100%; max-height:76vh; height:auto; }
  h1 { font-size:18px; margin:0; text-align:center; overflow-wrap:anywhere; }
  p { margin:0; opacity:.8; text-align:center; }
  a { color:inherit; }
  .btn { display:inline-block; padding:8px 16px; background:var(--accent); color:#2a1a3e;
         text-decoration:none; font-weight:700;
         box-shadow: 0 calc(-1*var(--px)) 0 0 var(--ink), 0 var(--px) 0 0 var(--ink),
                     calc(-1*var(--px)) 0 0 0 var(--ink), var(--px) 0 0 0 var(--ink); }
</style>
</head>
<body>
<main>
  {{- if .Failed}}
  <p>&gt; this wish is still being granted. reload in a moment.</p>
  {{- else if .IsVideo}}
  <div class="frame"><video src="{{.VideoURL}}" {{if .ThumbURL}}poster="{{.ThumbURL}}"{{end}} controls autoplay muted loop playsinline></video></div>
  {{- else if .IsImage}}
  <div class="frame"><img src="{{.RawURL}}" alt="{{.Title}}"{{if .Width}} width="{{.Width}}" height="{{.Height}}"{{end}}></div>
  {{- else}}
  <p>&gt; no preview for this kind of file.</p>
  {{- end}}
  <h1>{{.Title}}</h1>
  <p>{{.Mime}} · {{.Size}}{{if .Width}} · {{.Width}}×{{.Height}}{{end}}</p>
  <a class="btn" href="{{.RawURL}}?download=1">download</a>
</main>
</body>
</html>
`))
