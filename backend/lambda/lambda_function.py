import json
import traceback

from runtracker.logger import log
from runtracker.utils import (
    path_equals,
    format_response,
    has_invalid_domain,
)
from runtracker.run_routes import (
    upload_run_route,
    view_run_route,
)


def lambda_handler(event, context):
    try:
        log(json.dumps(event.get("headers")))
        result = route(event)
        log(result["statusCode"])
        return result
    except Exception:
        traceback.print_exc()
        return format_response(event=event, http_code=500, body="Internal server error")


# Only using POST with a plain string body so every request is a CORS "simple
# request" and the browser never sends an OPTIONS preflight (same reasoning as
# the GPS Location Sharer backend).
#
# see https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#simple_requests
def route(event):
    if has_invalid_domain(event=event):
        return format_response(event=event, http_code=403, body={"message": "Forbidden"})
    if path_equals(event=event, method="POST", path="/upload"):
        return upload_run_route(event)
    if path_equals(event=event, method="POST", path="/view"):
        return view_run_route(event)
    return format_response(event=event, http_code=403, body={"message": "Forbidden"})
