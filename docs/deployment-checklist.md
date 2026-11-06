# Deployment checklist

Everything here is run by hand. Nothing in the repo deploys automatically
except the three `release.sh` scripts, and those also only run when you run them.

What gets deployed:

| Piece | Where | Source |
|---|---|---|
| Run storage | DynamoDB table `kaios-run-tracker-prod` | — |
| API | Lambda `kaios-run-tracker-backend-prod` behind API Gateway at `api.runtracker.elliscode.com` | `backend/lambda/` |
| Share page | S3 bucket `daniel-townsend-run-tracker` behind CloudFront at `runtracker.elliscode.com` | `website/` |
| KaiOS app | sideloaded or packaged zip | `frontend/` |

Set these once in your shell before running the commands below:

```sh
export AWS_REGION=us-east-1          # wherever the sharer's backend lives
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export TABLE=kaios-run-tracker-prod
export FUNCTION=kaios-run-tracker-backend-prod
export ROLE=kaios-run-tracker-backend-role
export BUCKET=daniel-townsend-run-tracker
```

## 1. DynamoDB table

- [ ] Create the table. On-demand billing, `key1`/`key2` keys, the same shape as the sharer's table.

```sh
aws dynamodb create-table \
  --table-name $TABLE \
  --attribute-definitions AttributeName=key1,AttributeType=S AttributeName=key2,AttributeType=S \
  --key-schema AttributeName=key1,KeyType=HASH AttributeName=key2,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
aws dynamodb wait table-exists --table-name $TABLE
```

- [ ] Turn on TTL for the `expiration` attribute. It holds epoch **seconds**, set to upload time + 30 days.

```sh
aws dynamodb update-time-to-live --table-name $TABLE \
  --time-to-live-specification Enabled=true,AttributeName=expiration
```

## 2. Lambda execution role

- [ ] Create the role, give it CloudWatch logging, and allow get/put on this table only.

```sh
aws iam create-role --role-name $ROLE --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}'
aws iam attach-role-policy --role-name $ROLE \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name $ROLE --policy-name dynamodb-run-table --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"dynamodb:GetItem\", \"dynamodb:PutItem\"],
    \"Resource\": \"arn:aws:dynamodb:$AWS_REGION:$ACCOUNT_ID:table/$TABLE\"
  }]
}"
```

## 3. Lambda function

- [ ] Create the function from the current code. After the first time, `backend/release.sh` handles updates.

```sh
cd backend/lambda && zip -r ../lambda-initial.zip . -x "*.DS_Store" -x "*__pycache__*" && cd ../..
aws lambda create-function \
  --function-name $FUNCTION \
  --runtime python3.14 \
  --handler lambda_function.lambda_handler \
  --role arn:aws:iam::$ACCOUNT_ID:role/$ROLE \
  --timeout 10 \
  --memory-size 256 \
  --zip-file fileb://backend/lambda-initial.zip \
  --no-cli-pager
```

- [ ] Set the environment variables. Use JSON here because `DOMAIN_NAMES` contains commas, which break the CLI's shorthand syntax. Replace the key placeholder with the value of `run-tracker-api-key`, found under Credentials → Show key in the "tenor" project.

```sh
aws lambda update-function-configuration --function-name $FUNCTION --no-cli-pager --environment '{
  "Variables": {
    "APP_NAME": "kaios-run-tracker",
    "DYNAMODB_TABLE_NAME": "kaios-run-tracker-prod",
    "DOMAIN_NAMES": "https://runtracker.elliscode.com,http://runtracker.localhost",
    "GOOGLE_API_KEY": "PASTE_RUN_TRACKER_API_KEY"
  }
}'
```

  `DOMAIN_NAMES` lists the share page's origin and the KaiOS app's origin (`http://runtracker.localhost`). See step 8 if uploads from the app get a 403.

## 4. API Gateway (console, same setup as the sharer)

- [ ] Create a **REST API** named `kaios-run-tracker`.
- [ ] Create a `{proxy+}` resource with an **ANY** method. Use a Lambda proxy integration targeting `kaios-run-tracker-backend-prod`, and accept the prompt to grant API Gateway permission to invoke it.
- [ ] Deploy to a stage named `prod`.
- [ ] Set stage throttling, for example rate 5 and burst 10. The API is only for you, and this caps the cost if it's ever abused.
- [ ] Optionally, attach the same resource policy as the sharer, from `kaios-gps-location-sharer/backend/api-gateway/resource-policy.json`.

## 5. Certificates and DNS

- [ ] In ACM, request a certificate for `api.runtracker.elliscode.com` **in the API's region**, using DNS validation through Route 53.
- [ ] In ACM, request a certificate for `runtracker.elliscode.com` **in us-east-1**, which CloudFront requires.
- [ ] In API Gateway → Custom domain names, create `api.runtracker.elliscode.com` as a Regional endpoint using its certificate. Add an API mapping to `kaios-run-tracker` with stage `prod` and an empty path.
- [ ] In Route 53, create an A (alias) record from `api.runtracker.elliscode.com` to the API Gateway domain name.

## 6. Website bucket and CloudFront

- [ ] Create the bucket and leave public access blocked:

```sh
aws s3api create-bucket --bucket $BUCKET --region us-east-1
```

- [ ] In the CloudFront console, create a distribution:
  - Origin: the bucket, with **Origin access control** (let the console update the bucket policy).
  - Alternate domain: `runtracker.elliscode.com`, using the us-east-1 certificate.
  - Default root object: `index.html`.
  - Viewer protocol: redirect HTTP to HTTPS.
- [ ] Add the share-link rewrite. Share links look like `/view/<id>`, and S3 only has `/view/index.html`:
  1. CloudFront → **Functions** → Create function, named `run-tracker-view-rewrite` (runtime cloudfront-js-2.0).
  2. Paste in `website/cloudfront/view-rewrite.js`, then **Save** and **Publish**.
  3. On the distribution: **Behaviors** → edit the default behavior → **Function associations** → **Viewer request** → CloudFront Functions → `run-tracker-view-rewrite` → Save.
  4. Check it: `https://runtracker.elliscode.com/view/aaaaaaaaaaaaaaaa` should show the page saying "This run was not found" (once the API is up), not an `AccessDenied` XML error.

  Old `/view/index.html?id=…` links keep working, because the page also reads `?id=`.
- [ ] In Route 53, create an A (alias) record from `runtracker.elliscode.com` to the distribution.

## 7. Google Cloud (Maps)

- [x] Create a dedicated key, `run-tracker-api-key`, separate from the sharer's. It's restricted to the Maps JavaScript API, with `https://runtracker.elliscode.com/*` as its only HTTP referrer. Any other referrer gets Google's "Oops! Something went wrong."
- [x] Under Google Maps Platform → Map management, create a Map ID. Done: `kaios-run-tracker`, JavaScript/raster, `1bd00ae1989c1926be6665cb`, set in `website/js/map.js`. Advanced markers require one.

## 8. KaiOS app origin

The API rejects any request whose `Origin` header isn't in `DOMAIN_NAMES`, and that includes uploads from the app. The app's origin, `http://runtracker.localhost`, is already in step 3's environment variables.

- [ ] If an upload from the phone still gets a 403, check which origin the phone actually sent. The Lambda logs every request's headers on the first line.
  `aws logs tail /aws/lambda/$FUNCTION --since 10m | grep -i origin`
  Then re-run step 3's `update-function-configuration` with that origin in `DOMAIN_NAMES`.

## 9. Release the website

- [ ] From `website/`, run `sh release.sh`. It copies `frontend/src/js/stats.js` into `website/js/` first, so the share page always computes stats exactly like the app.
- [ ] After later releases, invalidate the CloudFront cache (or bump the `?v=` query strings):
  `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`

## 10. Package the KaiOS app

- [ ] From `frontend/`, run `sh release.sh`. It produces `runtracker-<timestamp>.zip`. Sideload that zip or the `frontend/` folder with your usual tool.

## 11. Smoke test

- [ ] An unknown ID should return `404 {"message": "Run not found"}`:

```sh
curl -s -i -X POST https://api.runtracker.elliscode.com/view \
  -H 'Origin: https://runtracker.elliscode.com' -d '{"id":"aaaaaaaaaaaaaaaa"}'
```

- [ ] A bad origin should return `403`:

```sh
curl -s -i -X POST https://api.runtracker.elliscode.com/view \
  -H 'Origin: https://example.com' -d '{"id":"aaaaaaaaaaaaaaaa"}'
```

- [ ] On the phone:
  1. Record a short walk.
  2. Open it and choose **Upload & share run**. You should see "Uploaded … until <date>", and the **Open map** and **Send link by SMS** buttons should appear.
  3. Choose **Open map**. The browser should open `runtracker.elliscode.com/view/<id>` and show the same distance, time, pace, and speed as the app, plus the route with S/F markers.
  4. Choose **Send link by SMS**. Messages should open with the run summary and the `/view/<id>` link filled in.
  5. Choose **Re-upload run**. The URL (share ID) should stay the same, and the "Uploaded" dialog's date should move out to 30 days from now.

## Limits worth knowing

- **Size:** a run is stored as one gzipped DynamoDB item. The API returns `413 Run too large` above roughly 380 KB compressed, which is several hours at 1 sample per second. Validation also caps a run at 30,000 samples and 24 hours.
- **Retention:** `expiration` resets to 30 days on every re-upload. Each item also stores `tier: "free"` for a future paid tier with no TTL.
- **Write protection:** the app stores the share token. The table keeps only its SHA-256 hash, and only a matching token can overwrite a share ID.
