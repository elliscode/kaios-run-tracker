import json
import os
from urllib.parse import parse_qsl

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from .logger import log

DOMAIN_NAMES = os.environ.get("DOMAIN_NAMES", "").split(",")
TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

dynamo = boto3.client("dynamodb")


def has_invalid_domain(event):
    headers = event.get("headers") or {}
    return "origin" not in headers or headers["origin"].rstrip("/") not in DOMAIN_NAMES


def format_response(event, http_code, body, headers=None, log_this=True):
    if isinstance(body, str):
        body = {"message": body}
    request_headers = event.get("headers") or {}
    if "origin" in request_headers and request_headers["origin"].rstrip("/") in DOMAIN_NAMES:
        domain_name = request_headers["origin"]
    else:
        log(f'Invalid origin {request_headers.get("origin")}')
        http_code = 403
        body = {"message": "Forbidden"}
        domain_name = "*"
    all_headers = {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Origin": domain_name,
        "Access-Control-Allow-Methods": "POST",
    }
    if headers is not None:
        all_headers.update(headers)
    if log_this:
        log(
            body,
        )
    return {
        "statusCode": http_code,
        "body": json.dumps(body),
        "headers": all_headers,
    }


def parse_body(body):
    if body is None:
        return {}
    if isinstance(body, dict):
        return body
    elif body.startswith("{"):
        return json.loads(body)
    return dict(parse_qsl(body))


def dynamo_obj_to_python_obj(dynamo_obj: dict) -> dict:
    deserializer = TypeDeserializer()
    return {k: deserializer.deserialize(v) for k, v in dynamo_obj.items()}


def python_obj_to_dynamo_obj(python_obj: dict) -> dict:
    serializer = TypeSerializer()
    return {k: serializer.serialize(v) for k, v in python_obj.items()}


def path_equals(event, method, path):
    event_path = event.get("path")
    if not event_path:
        event_path = event.get("requestContext", {}).get("http", {}).get("path")
        stage = event.get("requestContext", {}).get("stage")
        event_path = event_path.removeprefix(f"/{stage}")
    event_method = event.get("httpMethod", event.get("requestContext", {}).get("http", {}).get("method"))
    return event_method == method and (event_path == path or event_path == path + "/" or path == "*")
