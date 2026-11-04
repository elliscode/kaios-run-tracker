# Run from backend/: python3 -m unittest discover tests
#
# boto3/botocore are stubbed out in sys.modules (no AWS access, no installs
# needed); FakeDynamo mimics just enough of get_item/put_item, including the
# conditional write that guards client-generated run IDs.
import gzip
import json
import os
import sys
import time
import types
import unittest

os.environ["DOMAIN_NAMES"] = "https://runtracker.elliscode.com"
os.environ["DYNAMODB_TABLE_NAME"] = "test-table"
os.environ["GOOGLE_API_KEY"] = "test-maps-key"


class ClientError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeDynamo:
    def __init__(self):
        self.items = {}

    def put_item(self, TableName, Item, ConditionExpression=None, ExpressionAttributeValues=None):
        key = (Item["key1"], Item["key2"])
        existing = self.items.get(key)
        if existing is not None and existing["token_hash"] != ExpressionAttributeValues[":token_hash"]:
            raise ClientError("ConditionalCheckFailedException")
        self.items[key] = dict(Item)

    def get_item(self, TableName, Key):
        item = self.items.get((Key["key1"], Key["key2"]))
        return {"Item": dict(item)} if item is not None else {}


class IdentityTypes:
    def serialize(self, value):
        return value

    def deserialize(self, value):
        return value


fake_dynamo = FakeDynamo()
boto3 = types.ModuleType("boto3")
boto3.client = lambda name: fake_dynamo
boto3_dynamodb = types.ModuleType("boto3.dynamodb")
boto3_types = types.ModuleType("boto3.dynamodb.types")
boto3_types.TypeSerializer = IdentityTypes
boto3_types.TypeDeserializer = IdentityTypes
botocore = types.ModuleType("botocore")
botocore_exceptions = types.ModuleType("botocore.exceptions")
botocore_exceptions.ClientError = ClientError
sys.modules.update(
    {
        "boto3": boto3,
        "boto3.dynamodb": boto3_dynamodb,
        "boto3.dynamodb.types": boto3_types,
        "botocore": botocore,
        "botocore.exceptions": botocore_exceptions,
    }
)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lambda"))

import lambda_function  # noqa: E402
from runtracker.input_validation import validate_upload  # noqa: E402

RUN_ID = "abcdEFGH12345678"
TOKEN = "T" * 32
START = 1762250000000


def upload_body(run_id=RUN_ID, token=TOKEN, count=3):
    return {
        "v": 1,
        "id": run_id,
        "token": token,
        "startTime": START,
        "endTime": START + count * 1000,
        "samples": {
            "t": [i * 1000 for i in range(count)],
            "lat": [42.36 + i * 0.00003 for i in range(count)],
            "lon": [-71.05] * count,
            "alt": [None] + [12.5] * (count - 1),
            "acc": [6.0] * count,
            "altAcc": [None] * count,
        },
    }


def event(path, body, origin="https://runtracker.elliscode.com"):
    headers = {"origin": origin} if origin else {}
    return {"path": path, "httpMethod": "POST", "headers": headers, "body": json.dumps(body)}


def call(path, body, origin="https://runtracker.elliscode.com"):
    result = lambda_function.lambda_handler(event(path, body, origin), None)
    return result["statusCode"], json.loads(result["body"])


class ValidationTests(unittest.TestCase):
    def test_valid_upload(self):
        self.assertIsNotNone(validate_upload(upload_body()))

    def test_zero_offset_and_null_altitude_are_valid(self):
        body = upload_body()
        self.assertEqual(body["samples"]["t"][0], 0)
        self.assertIsNone(body["samples"]["alt"][0])
        self.assertIsNotNone(validate_upload(body))

    def test_rejects_bad_fields(self):
        cases = [
            lambda b: b.update(id="short"),
            lambda b: b.update(id="abcdEFGH1234567!"),
            lambda b: b.update(token="x"),
            lambda b: b.update(v=2),
            lambda b: b.update(startTime=START // 1000),
            lambda b: b.update(endTime=START - 1),
            lambda b: b["samples"]["lat"].append(1.0),
            lambda b: b["samples"]["lat"].__setitem__(0, 91),
            lambda b: b["samples"]["lon"].__setitem__(0, "-71"),
            lambda b: b["samples"]["acc"].__setitem__(0, None),
            lambda b: b["samples"]["t"].__setitem__(1, True),
            lambda b: b["samples"]["t"].__setitem__(1, float("nan")),
            lambda b: b["samples"].pop("altAcc"),
        ]
        for mutate in cases:
            body = upload_body()
            mutate(body)
            self.assertIsNone(validate_upload(body))

    def test_rejects_single_sample(self):
        self.assertIsNone(validate_upload(upload_body(count=1)))


class RouteTests(unittest.TestCase):
    def setUp(self):
        fake_dynamo.items.clear()

    def test_upload_then_view_round_trips(self):
        status, body = call("/upload", upload_body())
        self.assertEqual(status, 200)
        self.assertEqual(body["id"], RUN_ID)
        self.assertGreater(body["expiresAt"], time.time() * 1000 + 29 * 86400 * 1000)

        stored = fake_dynamo.items[(RUN_ID, "run")]
        self.assertNotIn(TOKEN, json.dumps(stored, default=str))
        self.assertNotIn("token", json.loads(gzip.decompress(stored["data"])))

        status, body = call("/view", {"id": RUN_ID})
        self.assertEqual(status, 200)
        self.assertEqual(body["key"], "test-maps-key")
        self.assertEqual(body["run"]["samples"]["lat"], upload_body()["samples"]["lat"])
        self.assertEqual(body["run"]["startTime"], START)

    def test_reupload_with_same_token_keeps_id(self):
        self.assertEqual(call("/upload", upload_body(count=3))[0], 200)
        status, body = call("/upload", upload_body(count=5))
        self.assertEqual(status, 200)
        self.assertEqual(body["id"], RUN_ID)
        self.assertEqual(len(call("/view", {"id": RUN_ID})[1]["run"]["samples"]["t"]), 5)

    def test_reupload_with_other_token_is_rejected(self):
        self.assertEqual(call("/upload", upload_body())[0], 200)
        status, _ = call("/upload", upload_body(token="U" * 32))
        self.assertEqual(status, 403)
        self.assertEqual(len(call("/view", {"id": RUN_ID})[1]["run"]["samples"]["t"]), 3)

    def test_unknown_and_expired_runs_are_not_found(self):
        self.assertEqual(call("/view", {"id": "zzzzzzzzzzzzzzzz"})[0], 404)
        call("/upload", upload_body())
        fake_dynamo.items[(RUN_ID, "run")]["expiration"] = int(time.time()) - 1
        self.assertEqual(call("/view", {"id": RUN_ID})[0], 404)

    def test_invalid_upload_is_400(self):
        self.assertEqual(call("/upload", {"id": RUN_ID})[0], 400)

    def test_bad_origin_and_unknown_path_are_forbidden(self):
        self.assertEqual(call("/upload", upload_body(), origin="https://evil.example")[0], 403)
        self.assertEqual(call("/upload", upload_body(), origin=None)[0], 403)
        self.assertEqual(call("/token", {"id": RUN_ID})[0], 403)
        self.assertEqual(fake_dynamo.items, {})


if __name__ == "__main__":
    unittest.main()
