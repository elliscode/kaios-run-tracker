# setup

See `../docs/deployment-checklist.md` for the full first-time setup (DynamoDB
table, IAM role, Lambda, API Gateway, domain).

Lambda environment variables:
- `APP_NAME` -- app identifier, used in logging
- `DOMAIN_NAMES` -- comma-separated list of allowed CORS origins (the website
  and the KaiOS app)
- `DYNAMODB_TABLE_NAME` -- table with `key1`/`key2` string keys and TTL on `expiration`
- `GOOGLE_API_KEY` -- Maps JavaScript API key, handed to the share page by `/view`

# releasing

run `sh release.sh` (deploys `kaios-run-tracker-backend-prod`)

# testing

`python3 -m unittest discover tests` -- boto3 is stubbed, no AWS access needed
