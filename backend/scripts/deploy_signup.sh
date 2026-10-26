#!/bin/sh
# Redeploys the website sign-up function after you edit src/signup.py.
# (First-time setup is create_signup.sh; the main backend uses deploy.sh.)
set -e
cd "$(dirname "$0")/.."
rm -rf /tmp/pkg-signup /tmp/signup.zip && mkdir /tmp/pkg-signup
cp src/signup.py /tmp/pkg-signup/ && (cd /tmp/pkg-signup && zip -q ../signup.zip signup.py)
aws lambda update-function-code --function-name polishai-signup --zip-file fileb:///tmp/signup.zip --region us-east-1 --query 'FunctionName' --output text
aws lambda wait function-updated --function-name polishai-signup --region us-east-1
echo "Sign-up function redeployed."
