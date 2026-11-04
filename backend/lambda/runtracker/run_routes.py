import gzip
import hashlib
import json
import time

from botocore.exceptions import ClientError

from .utils import (
    dynamo,
    TABLE_NAME,
    GOOGLE_API_KEY,
    format_response,
    parse_body,
    dynamo_obj_to_python_obj,
    python_obj_to_dynamo_obj,
)
from .input_validation import validate_upload, validate_view

# Free-tier retention; DynamoDB TTL deletes the item some time after this.
FREE_RETENTION_SECONDS = 30 * 24 * 60 * 60
# DynamoDB's hard item limit is 400 KB; leave room for the other attributes.
MAX_DATA_BYTES = 380 * 1024
RUN_SORT_KEY = "run"


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def run_key(run_id):
    return python_obj_to_dynamo_obj({"key1": run_id, "key2": RUN_SORT_KEY})


def upload_run_route(event):
    try:
        raw_body = parse_body(event.get("body"))
    except ValueError:
        raw_body = None
    body = validate_upload(raw_body)
    if not body:
        return format_response(event=event, http_code=400, body="Invalid run upload")

    token_hash = hash_token(body.pop("token"))
    data = gzip.compress(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    if len(data) > MAX_DATA_BYTES:
        return format_response(event=event, http_code=413, body="Run too large")

    now = int(time.time())
    expiration = now + FREE_RETENTION_SECONDS
    item = {
        "key1": body["id"],
        "key2": RUN_SORT_KEY,
        "data": data,
        "token_hash": token_hash,
        "uploaded_at": now,
        "expiration": expiration,
        # room for a future paid tier that skips the TTL
        "tier": "free",
        "sample_count": len(body["samples"]["t"]),
    }

    # Client-generated IDs: the first upload claims the ID, and only the
    # holder of the matching token can overwrite it afterwards.
    try:
        dynamo.put_item(
            TableName=TABLE_NAME,
            Item=python_obj_to_dynamo_obj(item),
            ConditionExpression="attribute_not_exists(key1) OR token_hash = :token_hash",
            ExpressionAttributeValues=python_obj_to_dynamo_obj({":token_hash": token_hash}),
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return format_response(event=event, http_code=403, body="This run ID belongs to someone else")
        raise

    return format_response(
        event=event,
        http_code=200,
        body={"id": body["id"], "expiresAt": expiration * 1000},
    )


def view_run_route(event):
    try:
        raw_body = parse_body(event.get("body"))
    except ValueError:
        raw_body = None
    run_id = validate_view(raw_body)
    if not run_id:
        return format_response(event=event, http_code=400, body="Invalid run ID")

    response = dynamo.get_item(TableName=TABLE_NAME, Key=run_key(run_id))
    if "Item" not in response:
        return format_response(event=event, http_code=404, body="Run not found")

    item = dynamo_obj_to_python_obj(response["Item"])
    # TTL deletion can lag by days, so check expiry ourselves
    if "expiration" in item and item["expiration"] < int(time.time()):
        return format_response(event=event, http_code=404, body="Run not found")

    data = item["data"]
    # TypeDeserializer wraps binary attributes in a Binary object
    raw = data.value if hasattr(data, "value") else data
    run = json.loads(gzip.decompress(raw).decode("utf-8"))

    return format_response(
        event=event,
        http_code=200,
        body={
            "id": run_id,
            "run": run,
            "expiresAt": int(item["expiration"]) * 1000,
            "key": GOOGLE_API_KEY,
        },
        log_this=False,
    )
