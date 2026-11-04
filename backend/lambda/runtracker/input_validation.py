import math
import re

ID_REGEX = re.compile("[a-zA-Z0-9]{16}")
TOKEN_REGEX = re.compile("[a-zA-Z0-9]{32}")

UPLOAD_VERSION = 1
MIN_SAMPLES = 2
# ~8 hours at 1 Hz; the gzipped item size check in run_routes is the real limit
MAX_SAMPLES = 30000
MAX_RUN_MS = 24 * 60 * 60 * 1000
# position.timestamp can trail the app's start/stop clock slightly
TIMESTAMP_SLACK_MS = 60 * 1000
EARLIEST_START_MS = 1_500_000_000_000  # 2017, rules out seconds-vs-ms mistakes

SAMPLE_COLUMNS = ["t", "lat", "lon", "alt", "acc", "altAcc"]


def validate_id(value):
    if isinstance(value, str) and ID_REGEX.fullmatch(value):
        return value
    return None


def validate_token(value):
    if isinstance(value, str) and TOKEN_REGEX.fullmatch(value):
        return value
    return None


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def is_in_range(value, low, high):
    return is_number(value) and low <= value <= high


def is_optional_in_range(value, low, high):
    return value is None or is_in_range(value, low, high)


def validate_view(body):
    if not isinstance(body, dict):
        return None
    return validate_id(body.get("id"))


# Returns the upload with only the expected fields, or None if anything about
# it is off. Written out by hand rather than through a generic schema because
# the sample columns hold falsy-but-valid values (t=0, alt=null) and need
# cross-field checks (equal column lengths, t within the run's duration).
def validate_upload(body):
    if not isinstance(body, dict) or body.get("v") != UPLOAD_VERSION:
        return None
    run_id = validate_id(body.get("id"))
    token = validate_token(body.get("token"))
    start_time = body.get("startTime")
    end_time = body.get("endTime")
    samples = body.get("samples")
    if not run_id or not token:
        return None
    if not isinstance(start_time, int) or not isinstance(end_time, int):
        return None
    if isinstance(start_time, bool) or isinstance(end_time, bool):
        return None
    if start_time < EARLIEST_START_MS or end_time < start_time or end_time - start_time > MAX_RUN_MS:
        return None
    if not isinstance(samples, dict):
        return None

    columns = {}
    for name in SAMPLE_COLUMNS:
        column = samples.get(name)
        if not isinstance(column, list):
            return None
        columns[name] = column
    count = len(columns["t"])
    if count < MIN_SAMPLES or count > MAX_SAMPLES:
        return None
    if any(len(column) != count for column in columns.values()):
        return None

    duration = end_time - start_time
    checks = [
        ("t", lambda v: is_in_range(v, -TIMESTAMP_SLACK_MS, duration + TIMESTAMP_SLACK_MS)),
        ("lat", lambda v: is_in_range(v, -90, 90)),
        ("lon", lambda v: is_in_range(v, -180, 180)),
        ("alt", lambda v: is_optional_in_range(v, -1000, 10000)),
        ("acc", lambda v: is_in_range(v, 0, 100000)),
        ("altAcc", lambda v: is_optional_in_range(v, 0, 100000)),
    ]
    for name, check in checks:
        if not all(check(value) for value in columns[name]):
            return None

    return {
        "v": UPLOAD_VERSION,
        "id": run_id,
        "token": token,
        "startTime": start_time,
        "endTime": end_time,
        "samples": columns,
    }
