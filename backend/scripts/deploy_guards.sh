#!/bin/sh
# Redeploys the two small safety functions (sign-up limit and kill switch) after you edit them.
# The main backend is deployed with backend/deploy.sh instead.
set -e
cd "$(dirname "$0")/.."
for name in presignup killswitch; do
  rm -rf "/tmp/pkg-$name" "/tmp/$name.zip" && mkdir "/tmp/pkg-$name"
  cp "src/$name.py" "/tmp/pkg-$name/"
  (cd "/tmp/pkg-$name" && zip -q "../$name.zip" "$name.py")
  aws lambda update-function-code --function-name "polishai-$name" --zip-file "fileb:///tmp/$name.zip" --region us-east-1 --query 'FunctionName' --output text
done
echo "Both safety functions redeployed. Run backend/scripts/check_protections.py to confirm."
