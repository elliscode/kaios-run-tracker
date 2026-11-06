// CloudFront Function (viewer request) for the runtracker.elliscode.com
// distribution. Share links look like /view/<16-char run id>; S3 only has
// /view/index.html, so serve that while the browser keeps the original URL
// (view.js reads the ID back out of the path). Any single dot-free segment
// under /view/ is rewritten, not just valid IDs, so a mangled link gets the
// page's own "missing a valid run ID" message instead of S3's AccessDenied
// XML. Everything else (including /view/index.html) passes through.
//
// Not deployed by any script: paste into CloudFront -> Functions, publish,
// and associate with the distribution's default behavior as "Viewer request".
// See docs/deployment-checklist.md.
function handler(event) {
  var request = event.request;
  if (/^\/view\/[^\/.]+\/?$/.test(request.uri)) {
    request.uri = '/view/index.html';
  }
  return request;
}
