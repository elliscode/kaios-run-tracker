#!/bin/bash
cd lambda/
TIMESTAMP=$(date +%s)
zip -vr ../lambda-release-prod-${TIMESTAMP}.zip . -x "*.DS_Store" -x "*__pycache__*"
cd ../
aws lambda update-function-code --function-name=kaios-run-tracker-backend-prod --zip-file=fileb://lambda-release-prod-${TIMESTAMP}.zip --no-cli-pager
