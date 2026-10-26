#!/bin/sh
# One-off setup for the website's download sign-up (table, role, function, public URL, alarm).
# Safe to read; running it twice stops at the first "already exists". Redeploy code afterwards with deploy_signup.sh.
# Usage: sh backend/scripts/create_signup.sh "https://your-site-origin"
set -e
cd "$(dirname "$0")/.."
REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
SITE_ORIGIN="${1:?pass the website origin, e.g. https://rahimrehann.github.io}"
TABLE=polishai-downloads
ROLE=polishai-signup-role
FN=polishai-signup

echo "1/6 table"
aws dynamodb create-table --region $REGION --table-name $TABLE \
  --attribute-definitions AttributeName=pk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH --billing-mode PAY_PER_REQUEST \
  --on-demand-throughput MaxReadRequestUnits=50,MaxWriteRequestUnits=25 \
  --deletion-protection-enabled --query 'TableDescription.TableStatus' --output text
aws dynamodb wait table-exists --region $REGION --table-name $TABLE
aws dynamodb update-time-to-live --region $REGION --table-name $TABLE \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt --output text >/dev/null

echo "2/6 role (can only touch the new table, plus logging)"
aws iam create-role --role-name $ROLE --query 'Role.RoleName' --output text \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name $ROLE --policy-name polishai-signup-least-priv --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:UpdateItem\"],\"Resource\":\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}\"}]}"
sleep 12

echo "3/6 function"
rm -rf /tmp/pkg-signup /tmp/signup.zip && mkdir /tmp/pkg-signup
cp src/signup.py /tmp/pkg-signup/ && (cd /tmp/pkg-signup && zip -q ../signup.zip signup.py)
SALT=$(openssl rand -hex 16)
aws lambda create-function --region $REGION --function-name $FN --runtime python3.13 \
  --role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" --handler signup.lambda_handler \
  --zip-file fileb:///tmp/signup.zip --timeout 5 --memory-size 128 \
  --environment "Variables={TABLE_NAME=$TABLE,MAX_SIGNUPS_PER_DAY=500,MAX_PER_VISITOR_PER_HOUR=5,IP_SALT=$SALT}" \
  --query 'FunctionName' --output text
aws logs create-log-group --region $REGION --log-group-name /aws/lambda/$FN
aws logs put-retention-policy --region $REGION --log-group-name /aws/lambda/$FN --retention-in-days 30

echo "4/6 public URL (only the website's address may call it from a browser)"
aws lambda create-function-url-config --region $REGION --function-name $FN --auth-type NONE \
  --cors "AllowOrigins=$SITE_ORIGIN,http://localhost:8765,AllowMethods=POST,AllowHeaders=content-type,MaxAge=3600" \
  --query 'FunctionUrl' --output text
aws lambda add-permission --region $REGION --function-name $FN --statement-id public-url \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE --output text >/dev/null
aws lambda add-permission --region $REGION --function-name $FN --statement-id public-url-invoke \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url --output text >/dev/null

echo "5/6 alarm (emails you if the form is being hammered)"
aws cloudwatch put-metric-alarm --region $REGION --alarm-name polishai-signup-flood \
  --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=$FN \
  --statistic Sum --period 300 --evaluation-periods 1 --threshold 1000 \
  --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching \
  --alarm-actions "arn:aws:sns:${REGION}:${ACCOUNT}:polishai-alerts"

echo "6/6 done"
